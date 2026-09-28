const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const nativeStubs = {
    sharp() {
        const chain = {
            rotate() { return chain; },
            resize() { return chain; },
            webp() { return chain; },
            toBuffer: async () => Buffer.alloc(0),
            metadata: async () => ({ width: 1, height: 1 })
        };
        return chain;
    },
    winston: {
        createLogger() {
            return {
                info() {},
                warn() {},
                error() {},
                debug() {},
                bootSubStep() {}
            };
        },
        format: { combine() { return {}; }, timestamp() { return {}; }, printf() { return {}; }, colorize() { return {}; } },
        transports: {
            Console: function Console() {},
            File: function File() {}
        }
    },
    'express-rate-limit': {
        rateLimit() {
            return function limiter(req, res, next) {
                if (typeof next === 'function') next();
            };
        },
        ipKeyGenerator(ip) { return ip || 'unknown'; }
    },
    canvas: {
        createCanvas() { return { getContext() { return {}; } }; },
        loadImage: async () => ({})
    },
    terser: {
        minify: async (code) => ({ code: code || '' })
    },
    lightningcss: {
        transform({ code }) { return { code: Buffer.from(code || '') }; }
    },
    blurhash: {
        encode() { return 'stub'; },
        decode() { return new Uint8ClampedArray(0); }
    }
};
const origRequire = Module.prototype.require;
Module.prototype.require = function stubNative(id) {
    if (Object.prototype.hasOwnProperty.call(nativeStubs, id)) {
        try {
            return origRequire.apply(this, arguments);
        } catch (_err) {
            return nativeStubs[id];
        }
    }
    return origRequire.apply(this, arguments);
};

const {
    mcpTokenAllowsHardDelete,
    rejectMcpTokenConfigMutation,
    isMcpAgentClient,
    isAdminUserSession,
    authPayloadForClient,
    agentCannotSeeFilename,
    agentShouldNoopGalleryName,
    filenameHiddenByFakeDelete,
    filenameIsModerationFlagged,
    collectPayloadFilenames,
    rejectAgentHiddenHttpFile,
    filterGroupsVisibleToClient,
    filterVfsListItemsVisibleToClient,
    countPairedGalleryFilenames
} = require('../modules/imageModerationFlag');
const {
    getPacketScopes,
    scopesAllowPacket,
    ADMIN_MANAGEMENT_WS_PACKETS,
    ApplicationAuthManager
} = require('../modules/applicationAuthManager');
const { initializeApplicationAuthDatabase, getDb } = require('../modules/applicationAuthDatabase');
const { handleUpdateApplicationKeyFlags } = require('../modules/ws/handlers/195-applicationAuthHandler');
const {
    handleDeleteImagesBulk,
    handleDeleteUnupscaledOriginal,
    handleImageMetadataRequest,
    handleFindImageIndexRequest
} = require('../modules/ws/handlers/120-galleryHandler');
const WorkspaceManager = require('../modules/workspace');
const { WorkspaceWebSocketHandlers } = require('../modules/ws/handlers/90-workspaceHandler');
const { filterFilenamesVisibleToClient } = require('../modules/imageModerationFlag');
const { VfsManager } = require('../modules/vfsManager');
const VfsWebSocketHandlers = require('../modules/vfsWebSocketHandlers');
const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');
const vfsDatabase = require('../modules/vfsDatabase');
const metadataDatabase = require('../modules/metadataDatabase');
const metadataWriteQueue = require('../modules/metadataWriteQueue');
const { registerPackets: registerWorkspacePackets } = require('../modules/ws/handlers/90-workspaceHandler');
const { _test } = require('../modules/mcpAgentFacade');
const { UNDER_REVIEW_ERROR } = require('../modules/imageModerationFlag');

function parseToolText(result) {
    const text = result && result.content && result.content[0] && result.content[0].text;
    return text ? JSON.parse(text) : {};
}

assert.strictEqual(mcpTokenAllowsHardDelete(null), false);
assert.strictEqual(mcpTokenAllowsHardDelete({}), false);
assert.strictEqual(mcpTokenAllowsHardDelete({ applicationAuth: {} }), false);
assert.strictEqual(mcpTokenAllowsHardDelete({ applicationAuth: { allowDelete: false } }), false);
assert.strictEqual(mcpTokenAllowsHardDelete({ applicationAuth: { allowDelete: true } }), true);
assert.strictEqual(mcpTokenAllowsHardDelete({ allowDelete: true }), true);

assert.strictEqual(isMcpAgentClient({ authMethod: 'application_key' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'oauth_access_token' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'temp_token' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'dev_login_key' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'dev_admin_session' }), true);
assert.strictEqual(isMcpAgentClient({ userType: 'dev_admin' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'session', userType: 'admin' }), false);
assert.strictEqual(isAdminUserSession({ userType: 'admin' }), true);
assert.strictEqual(isAdminUserSession({ userType: 'admin', authMethod: 'application_key' }), false);
assert.strictEqual(isAdminUserSession({ userType: 'dev_admin' }), false);

assert.ok(ADMIN_MANAGEMENT_WS_PACKETS.has('update_application_key_flags'));
assert.deepStrictEqual(getPacketScopes('update_application_key_flags'), []);
assert.strictEqual(scopesAllowPacket(['gallery'], 'update_application_key_flags'), false);
assert.strictEqual(scopesAllowPacket(['universal'], 'update_application_key_flags'), true);
assert.ok(!_test.TOOL_DEFS.some((t) => /allow_delete|update_application_key|unflag|clear_image_flag/i.test(t.name)));
assert.ok(_test.TOOL_DEFS.some((t) => t.name === 'delete_images'));

function seedDeleteTree(root, extras) {
    const imagesDir = path.join(root, 'images');
    const previewsDir = path.join(root, 'previews');
    const cacheDir = path.join(root, 'cache', 'dynGenPreview');
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(previewsDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    const files = extras && extras.files ? extras.files : {
        'a.png': 'orig',
        'a_upscaled.png': 'up'
    };
    for (const [name, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(imagesDir, name), body);
    }
    if (!(extras && extras.skipPreviews)) {
        fs.writeFileSync(path.join(previewsDir, 'a.webp'), 'w');
        fs.writeFileSync(path.join(previewsDir, 'a@2x.webp'), 'w2');
        fs.writeFileSync(path.join(previewsDir, 'a@lq.webp'), 'lq');
        fs.writeFileSync(path.join(previewsDir, 'a@blur.webp'), 'blur');
        fs.writeFileSync(path.join(previewsDir, 'a_preview.png'), 'legacy');
    }
    return { imagesDir, previewsDir, cacheDir };
}

/**
 * Frozen copy of main 1b1b7aa handleDeleteImagesBulk's sequential loop.
 * Ground truth for PR real + fake response shape. Not the PR planner.
 */
function frozenMainBulkDelete(globalResources, filenames) {
    const results = [];
    const errors = [];
    const getBaseName = (filename) => filename.replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/, '');
    const getPreviewFilename = (baseName) => `${baseName}_preview.png`;

    for (const filename of filenames) {
        try {
            const filePath = path.join(globalResources.getPath('images'), filename);
            if (!fs.existsSync(filePath)) {
                errors.push({ filename, error: 'File not found' });
                continue;
            }
            const baseName = getBaseName(filename);
            const previewFiles = [
                path.join(globalResources.getPath('previews'), `${baseName}.webp`),
                path.join(globalResources.getPath('previews'), `${baseName}@2x.webp`),
                path.join(globalResources.getPath('previews'), `${baseName}@lq.webp`),
                path.join(globalResources.getPath('previews'), `${baseName}@blur.webp`),
                path.join(globalResources.getPath('previews'), getPreviewFilename(baseName))
            ];
            const filesToDelete = [];
            let originalFilename;
            let upscaledFilename;
            if (filename.includes('_upscaled')) {
                upscaledFilename = filename;
                originalFilename = filename.replace('_upscaled.png', '.png');
            } else {
                originalFilename = filename;
                upscaledFilename = filename.replace('.png', '_upscaled.png');
            }
            const originalPath = path.join(globalResources.getPath('images'), originalFilename);
            if (fs.existsSync(originalPath)) {
                filesToDelete.push({ path: originalPath, type: 'original' });
                try {
                    const imageBuffer = fs.readFileSync(originalPath);
                    const metadata = globalResources.getPngMetadata().readMetadata(imageBuffer);
                    if (metadata && metadata.tEXt && metadata.tEXt.Comment) {
                        const commentData = JSON.parse(metadata.tEXt.Comment);
                        const previewHash = commentData
                            && commentData.forge_data
                            && commentData.forge_data.dynamic_generation
                            && commentData.forge_data.dynamic_generation.compiled_prompt
                            && commentData.forge_data.dynamic_generation.compiled_prompt.preview_image_hash;
                        if (previewHash) {
                            const dynGenPreviewPath = path.join(
                                globalResources.getPath('cache'),
                                'dynGenPreview',
                                `${previewHash}.png`
                            );
                            if (fs.existsSync(dynGenPreviewPath)) {
                                filesToDelete.push({ path: dynGenPreviewPath, type: 'dynGenPreview' });
                            }
                        }
                    }
                } catch (_metadataError) { /* same silent skip as main */ }
            }
            const upscaledPath = path.join(globalResources.getPath('images'), upscaledFilename);
            if (fs.existsSync(upscaledPath)) {
                filesToDelete.push({ path: upscaledPath, type: 'upscaled' });
            }
            for (const previewFilePath of previewFiles) {
                if (fs.existsSync(previewFilePath)) {
                    filesToDelete.push({ path: previewFilePath, type: 'preview' });
                }
            }
            const deletedFiles = [];
            for (const file of filesToDelete) {
                try {
                    fs.unlinkSync(file.path);
                    deletedFiles.push(file.type);
                } catch (error) {
                    console.error(`Failed to delete ${file.type}: ${path.basename(file.path)}`, error.message);
                }
            }
            results.push({ filename, deletedFiles });
        } catch (error) {
            errors.push({ filename, error: error.message });
        }
    }
    return {
        success: true,
        message: 'Bulk delete completed',
        results,
        errors,
        totalProcessed: filenames.length,
        successful: results.length,
        failed: errors.length
    };
}

function makeWorkspaceState(initial) {
    const workspaces = initial || {
        default: { scraps: [], files: [], hiddenByFakeDelete: [] },
        lab: { scraps: [], files: [], hiddenByFakeDelete: [] }
    };
    const scraps = [];
    return {
        scraps,
        workspaces,
        api: {
            addToWorkspaceArray(type, filename, id) {
                if (!workspaces[id]) throw new Error(`Workspace ${id} not found`);
                scraps.push({ type, filename, id });
                if (!Array.isArray(workspaces[id][type])) workspaces[id][type] = [];
                if (filename && !workspaces[id][type].includes(filename)) {
                    workspaces[id][type].push(filename);
                }
                for (const rec of Object.values(workspaces)) {
                    if (Array.isArray(rec.files)) {
                        rec.files = rec.files.filter((name) => name !== filename);
                    }
                }
            },
            getWorkspace(id) { return workspaces[id] || null; },
            getWorkspaces() { return workspaces; },
            markHiddenByFakeDelete(filenames, workspaceId) {
                const targetId = workspaces[workspaceId] ? workspaceId : 'default';
                if (!workspaces[targetId]) throw new Error(`Workspace ${targetId} not found`);
                if (!Array.isArray(workspaces[targetId].hiddenByFakeDelete)) {
                    workspaces[targetId].hiddenByFakeDelete = [];
                }
                for (const name of Array.isArray(filenames) ? filenames : [filenames]) {
                    if (name && !workspaces[targetId].hiddenByFakeDelete.includes(name)) {
                        workspaces[targetId].hiddenByFakeDelete.push(name);
                    }
                }
                return targetId;
            },
            clearHiddenByFakeDelete(filenames) {
                const drop = new Set(Array.isArray(filenames) ? filenames : [filenames]);
                let cleared = 0;
                for (const rec of Object.values(workspaces)) {
                    if (!Array.isArray(rec.hiddenByFakeDelete)) continue;
                    rec.hiddenByFakeDelete = rec.hiddenByFakeDelete.filter((name) => {
                        if (!drop.has(name)) return true;
                        cleared += 1;
                        return false;
                    });
                }
                return cleared;
            },
            listHiddenByFakeDelete() {
                const names = [];
                for (const rec of Object.values(workspaces)) {
                    for (const name of rec.hiddenByFakeDelete || []) {
                        if (name) names.push(name);
                    }
                }
                return names;
            },
            removeFilesFromWorkspaces() {}
        }
    };
}

function makeDeleteHandlers(root, options) {
    const sent = [];
    const broadcasts = [];
    const flagged = new Set(options && options.flagged ? options.flagged : []);
    const allowDelete = !!(options && options.allowDelete);
    const workspaceState = (options && options.workspaceState) || makeWorkspaceState();
    const imagesDir = path.join(root, 'images');
    const previewsDir = path.join(root, 'previews');
    const cacheDir = path.join(root, 'cache');
    const globalResources = {
        getPath(kind) {
            if (kind === 'images') return imagesDir;
            if (kind === 'previews') return previewsDir;
            if (kind === 'cache') return cacheDir;
            return root;
        },
        getPngMetadata: () => ({ readMetadata() { return {}; } }),
        getWorkspaceManager: () => workspaceState.api,
        getWebSocketServer: () => ({
            broadcast(msg, filter) { broadcasts.push({ msg, filter }); }
        }),
        getReferenceMetadataDatabase: () => ({ deleteMetadata() {} }),
        getMetadataDatabase: () => ({
            async removeImageMetadata() {},
            async isImageOrPairFlagged(filename) { return flagged.has(filename); },
            async isImageFlagged(filename) { return flagged.has(filename); }
        }),
        getApplicationAuthManager: () => ({
            async getApplicationKeyAllowDelete() { return allowDelete; }
        })
    };
    const handlers = {
        globalResources,
        sendToClient(_ws, payload) { sent.push(payload); },
        sendError(_ws, message, details) { sent.push({ type: 'error', message, details }); }
    };
    return {
        handlers,
        scraps: workspaceState.scraps,
        sent,
        broadcasts,
        globalResources,
        workspaceState
    };
}

async function runBulkDelete(root, clientInfo, filenames, extra) {
    const harness = makeDeleteHandlers(root, extra);
    await handleDeleteImagesBulk(
        harness.handlers,
        {},
        { filenames, workspace: extra && extra.workspace != null ? extra.workspace : 'lab', requestId: 'r-del' },
        clientInfo,
        { broadcast(msg) { harness.broadcasts.push({ msg }); } }
    );
    return harness;
}

function agentClient() {
    return {
        authMethod: 'application_key',
        applicationKeyId: 'key-1',
        applicationAuth: { applicationKeyId: 'key-1', allowDelete: false },
        sessionId: 'sess-agent'
    };
}

function userClient() {
    return { userType: 'admin', authMethod: 'session', sessionId: 'sess-owner' };
}

function pathsForRoot(root) {
    return {
        getPath(kind) {
            if (kind === 'images') return path.join(root, 'images');
            if (kind === 'previews') return path.join(root, 'previews');
            if (kind === 'cache') return path.join(root, 'cache');
            return root;
        },
        getPngMetadata: () => ({ readMetadata() { return {}; } })
    };
}

async function testRealAndFakeMatchFrozenMain() {
    const user = userClient();
    const agent = agentClient();

    const existingMain = fs.mkdtempSync(path.join(os.tmpdir(), 'del-main-'));
    const existingReal = fs.mkdtempSync(path.join(os.tmpdir(), 'del-real-'));
    const existingFake = fs.mkdtempSync(path.join(os.tmpdir(), 'del-fake-'));
    seedDeleteTree(existingMain);
    seedDeleteTree(existingReal);
    seedDeleteTree(existingFake);

    const mainExisting = frozenMainBulkDelete(pathsForRoot(existingMain), ['a.png']);
    const realExisting = await runBulkDelete(existingReal, user, ['a.png']);
    const fakeExisting = await runBulkDelete(existingFake, agent, ['a.png']);
    assert.deepStrictEqual(realExisting.sent[0].data, mainExisting);
    assert.deepStrictEqual(fakeExisting.sent[0].data, mainExisting);
    assert.deepStrictEqual(mainExisting.results[0].deletedFiles, ['original', 'upscaled', 'preview', 'preview', 'preview', 'preview', 'preview']);
    assert.ok(fs.existsSync(path.join(existingFake, 'images', 'a.png')));
    assert.ok(!fs.existsSync(path.join(existingReal, 'images', 'a.png')));
    assert.ok(!fs.existsSync(path.join(existingMain, 'images', 'a.png')));
    assert.strictEqual(fakeExisting.scraps.some((row) => row.filename === 'a.png' && row.id === 'lab'), true);
    assert.strictEqual(fakeExisting.scraps.some((row) => row.filename === 'a_upscaled.png'), true);
    assert.strictEqual(await agentCannotSeeFilename(fakeExisting.globalResources, 'a.png'), true);
    assert.strictEqual(filenameHiddenByFakeDelete(fakeExisting.globalResources, 'a.png'), true);

    const missingMain = fs.mkdtempSync(path.join(os.tmpdir(), 'del-miss-main-'));
    const missingReal = fs.mkdtempSync(path.join(os.tmpdir(), 'del-miss-real-'));
    const missingFake = fs.mkdtempSync(path.join(os.tmpdir(), 'del-miss-fake-'));
    seedDeleteTree(missingMain);
    seedDeleteTree(missingReal);
    seedDeleteTree(missingFake);
    const mainMissing = frozenMainBulkDelete(pathsForRoot(missingMain), ['nope.png']);
    const realMissing = await runBulkDelete(missingReal, user, ['nope.png']);
    const fakeMissing = await runBulkDelete(missingFake, agent, ['nope.png']);
    assert.deepStrictEqual(realMissing.sent[0].data, mainMissing);
    assert.deepStrictEqual(fakeMissing.sent[0].data, mainMissing);
    assert.deepStrictEqual(mainMissing.errors, [{ filename: 'nope.png', error: 'File not found' }]);
    assert.strictEqual(mainMissing.successful, 0);
    assert.strictEqual(fakeMissing.scraps.length, 0);

    const pairMain = fs.mkdtempSync(path.join(os.tmpdir(), 'del-pair-main-'));
    const pairReal = fs.mkdtempSync(path.join(os.tmpdir(), 'del-pair-real-'));
    const pairFake = fs.mkdtempSync(path.join(os.tmpdir(), 'del-pair-fake-'));
    seedDeleteTree(pairMain);
    seedDeleteTree(pairReal);
    seedDeleteTree(pairFake);
    const pairNames = ['a.png', 'a_upscaled.png'];
    const mainPair = frozenMainBulkDelete(pathsForRoot(pairMain), pairNames);
    const realPair = await runBulkDelete(pairReal, user, pairNames);
    const fakePair = await runBulkDelete(pairFake, agent, pairNames);
    assert.strictEqual(mainPair.successful, 1);
    assert.strictEqual(mainPair.failed, 1);
    assert.deepStrictEqual(mainPair.errors, [{ filename: 'a_upscaled.png', error: 'File not found' }]);
    assert.deepStrictEqual(realPair.sent[0].data, mainPair);
    assert.deepStrictEqual(fakePair.sent[0].data, mainPair);

    const dupMain = fs.mkdtempSync(path.join(os.tmpdir(), 'del-dup-main-'));
    const dupReal = fs.mkdtempSync(path.join(os.tmpdir(), 'del-dup-real-'));
    const dupFake = fs.mkdtempSync(path.join(os.tmpdir(), 'del-dup-fake-'));
    seedDeleteTree(dupMain);
    seedDeleteTree(dupReal);
    seedDeleteTree(dupFake);
    const dupNames = ['a.png', 'a.png'];
    const mainDup = frozenMainBulkDelete(pathsForRoot(dupMain), dupNames);
    const realDup = await runBulkDelete(dupReal, user, dupNames);
    const fakeDup = await runBulkDelete(dupFake, agent, dupNames);
    assert.strictEqual(mainDup.successful, 1);
    assert.strictEqual(mainDup.failed, 1);
    assert.deepStrictEqual(mainDup.errors, [{ filename: 'a.png', error: 'File not found' }]);
    assert.deepStrictEqual(realDup.sent[0].data, mainDup);
    assert.deepStrictEqual(fakeDup.sent[0].data, mainDup);

    const orderMain = fs.mkdtempSync(path.join(os.tmpdir(), 'del-order-main-'));
    const orderFake = fs.mkdtempSync(path.join(os.tmpdir(), 'del-order-fake-'));
    seedDeleteTree(orderMain, { files: {} });
    seedDeleteTree(orderFake);
    const orderNames = ['flagged.png', 'nope.png'];
    const mainOrder = frozenMainBulkDelete(pathsForRoot(orderMain), orderNames);
    const fakeOrder = await runBulkDelete(orderFake, agent, orderNames, { flagged: ['flagged.png'] });
    assert.deepStrictEqual(fakeOrder.sent[0].data, mainOrder);
    assert.deepStrictEqual(mainOrder.errors, [
        { filename: 'flagged.png', error: 'File not found' },
        { filename: 'nope.png', error: 'File not found' }
    ]);
    assert.strictEqual(fakeOrder.scraps.length, 0);
    assert.ok(fs.existsSync(path.join(orderFake, 'images', 'a.png')));

    const ghostMain = fs.mkdtempSync(path.join(os.tmpdir(), 'del-ghost-main-'));
    const ghostFake = fs.mkdtempSync(path.join(os.tmpdir(), 'del-ghost-fake-'));
    seedDeleteTree(ghostMain);
    seedDeleteTree(ghostFake);
    const mainGhost = frozenMainBulkDelete(pathsForRoot(ghostMain), ['a.png']);
    const fakeGhost = await runBulkDelete(ghostFake, agent, ['a.png'], { workspace: 'ghost' });
    assert.deepStrictEqual(fakeGhost.sent[0].data, mainGhost);
    assert.ok(fakeGhost.scraps.every((row) => row.id === 'default'));
    assert.ok(fakeGhost.scraps.some((row) => row.filename === 'a.png'));
    assert.strictEqual(filenameHiddenByFakeDelete(fakeGhost.globalResources, 'a.png'), true);
    assert.strictEqual(await agentCannotSeeFilename(fakeGhost.globalResources, 'a.png'), true);
}

async function testOrdinaryScrapsStayVisible() {
    const agent = agentClient();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'del-scrap-vis-'));
    seedDeleteTree(root, { files: { 'keep.png': 'k', 'a.png': 'orig', 'a_upscaled.png': 'up' } });
    const workspaceState = makeWorkspaceState();
    workspaceState.api.addToWorkspaceArray('scraps', 'keep.png', 'default');
    const harness = makeDeleteHandlers(root, { workspaceState });
    assert.strictEqual(await agentCannotSeeFilename(harness.globalResources, 'keep.png'), false);
    assert.strictEqual(filenameHiddenByFakeDelete(harness.globalResources, 'keep.png'), false);

    await handleDeleteUnupscaledOriginal(
        harness.handlers,
        {},
        { filename: 'a.png', workspace: 'lab', requestId: 'r-unup' },
        agent,
        { broadcast(msg) { harness.broadcasts.push({ msg }); } }
    );
    assert.strictEqual(harness.sent[0].data.success, true);
    assert.ok(fs.existsSync(path.join(root, 'images', 'a.png')));
    assert.ok(fs.existsSync(path.join(root, 'images', 'a_upscaled.png')));
    assert.strictEqual(filenameHiddenByFakeDelete(harness.globalResources, 'a.png'), true);
    assert.strictEqual(await agentCannotSeeFilename(harness.globalResources, 'a.png'), true);
    assert.strictEqual(filenameHiddenByFakeDelete(harness.globalResources, 'a_upscaled.png'), false);
    assert.strictEqual(await agentCannotSeeFilename(harness.globalResources, 'a_upscaled.png'), false);
    assert.strictEqual(await agentCannotSeeFilename(harness.globalResources, 'keep.png'), false);
}

async function testDeleteUnupscaledOriginalGated() {
    const agent = agentClient();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'del-unup-'));
    seedDeleteTree(root);
    const harness = makeDeleteHandlers(root, {});
    await handleDeleteUnupscaledOriginal(
        harness.handlers,
        {},
        { filename: 'a.png', workspace: 'lab', requestId: 'r-unup' },
        agent,
        { broadcast(msg) { harness.broadcasts.push({ msg }); } }
    );
    assert.strictEqual(harness.sent[0].data.success, true);
    assert.strictEqual(harness.sent[0].data.originalFilename, 'a.png');
    assert.strictEqual(harness.sent[0].data.upscaledFilename, 'a_upscaled.png');
    assert.ok(fs.existsSync(path.join(root, 'images', 'a.png')));
    assert.strictEqual(harness.scraps[0].filename, 'a.png');

    const flaggedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'del-unup-flag-'));
    seedDeleteTree(flaggedRoot);
    const flaggedHarness = makeDeleteHandlers(flaggedRoot, { flagged: ['a.png'] });
    await handleDeleteUnupscaledOriginal(
        flaggedHarness.handlers,
        {},
        { filename: 'a.png', requestId: 'r-unup-flag' },
        agent,
        { broadcast() {} }
    );
    assert.strictEqual(flaggedHarness.sent[0].type, 'error');
    assert.strictEqual(flaggedHarness.sent[0].message, 'Original file not found');
}

async function testMcpCannotFlipAllowDelete() {
    let flipped = false;
    const handlers = {
        last: null,
        sendError(_ws, message, details) {
            this.last = { message, details };
        },
        globalResources: {
            getApplicationAuthManager: () => ({
                async setApplicationKeyAllowDelete() {
                    flipped = true;
                    return { success: true, summary: { allowDelete: true } };
                }
            })
        }
    };
    const mcpClients = [
        { userType: 'admin', authMethod: 'application_key', applicationAuth: { applicationScopes: ['universal'] } },
        { userType: 'admin', authMethod: 'oauth_access_token' },
        { userType: 'dev_admin', authMethod: 'dev_login_key' }
    ];
    for (const client of mcpClients) {
        assert.strictEqual(isMcpAgentClient(client), true);
        handlers.last = null;
        await handleUpdateApplicationKeyFlags(
            handlers,
            {},
            { keyId: 'key-1', allowDelete: true, requestId: 'r1' },
            client,
            { sendToClient() { throw new Error('MCP must not reach success'); } }
        );
        assert.strictEqual(flipped, false);
        assert.ok(handlers.last);
        assert.strictEqual(handlers.last.details, 'USER_ONLY');
    }

    const denied = rejectMcpTokenConfigMutation();
    assert.strictEqual(denied.code, 'USER_ONLY');
    assert.strictEqual(denied.status, 403);

    const leaked = authPayloadForClient({
        success: true,
        keys: [{ id: 'key-1', allowDelete: true }],
        summary: { id: 'key-1', allowDelete: true }
    }, { authMethod: 'application_key' });
    assert.strictEqual(leaked.keys[0].allowDelete, undefined);
    assert.strictEqual(leaked.summary.allowDelete, undefined);
    const adminView = authPayloadForClient({
        success: true,
        keys: [{ id: 'key-1', allowDelete: true }]
    }, { authMethod: 'session' });
    assert.strictEqual(adminView.keys[0].allowDelete, true);

    try {
        await _test.callTool({
            getWorkspaceManager: () => ({ addToWorkspaceArray() {}, getWorkspaces() { return {}; } }),
            getWebSocketServer: () => ({ broadcast() {} }),
            getWebSocketMessageHandlers: () => ({ isDestructiveOperation() { return false; } }),
            getMetadataDatabase: () => ({ async isImageOrPairFlagged() { return false; } }),
            getPath: () => os.tmpdir()
        }, {
            authMethod: 'application_key',
            applicationAuth: { applicationScopes: ['universal'] }
        }, 'update_application_key_flags', { keyId: 'key-1', allowDelete: true });
        assert.fail('MCP must not have an update_application_key_flags tool');
    } catch (error) {
        assert.ok(String(error.message).includes('Unknown tool'));
    }
}

async function testExistingTokensDefaultOff() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allow-delete-'));
    const ok = await initializeApplicationAuthDatabase(dir);
    assert.strictEqual(ok, true);
    const manager = new ApplicationAuthManager({});
    const created = await manager.createApplicationKey({
        appName: 'guren',
        userAgent: 'Guren/1.0',
        scopes: ['gallery']
    });
    assert.strictEqual(created.summary.allowDelete, false);
    const row = await getDb().get('SELECT allow_delete FROM application_keys WHERE id = ?', [created.summary.id]);
    assert.strictEqual(row.allow_delete, 0);
    const listed = await manager.listApplicationKeys();
    assert.strictEqual(listed[0].allowDelete, false);
    const updated = await manager.setApplicationKeyAllowDelete(created.summary.id, true);
    assert.strictEqual(updated.success, true);
    assert.strictEqual(updated.summary.allowDelete, true);
    const after = await getDb().get('SELECT allow_delete FROM application_keys WHERE id = ?', [created.summary.id]);
    assert.strictEqual(after.allow_delete, 1);
    const live = await manager.getApplicationKeyAllowDelete(created.summary.id);
    assert.strictEqual(live, true);
}

async function testFacadePassesWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'del-facade-'));
    seedDeleteTree(root);
    const workspaceState = makeWorkspaceState();
    const globalResources = makeDeleteHandlers(root, { workspaceState }).globalResources;
    const broadcasts = [];
    globalResources.getWebSocketServer = () => ({
        broadcast(msg, filter) { broadcasts.push({ msg, filter }); }
    });
    const body = parseToolText(await _test.callTool(
        globalResources,
        {
            authMethod: 'application_key',
            applicationKeyId: 'key-1',
            applicationAuth: { applicationScopes: ['gallery', 'workspace'], applicationKeyId: 'key-1' }
        },
        'delete_images',
        { filename: 'a.png', workspace: 'lab' }
    ));
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.message, 'Bulk delete completed');
    assert.ok(workspaceState.scraps.some((row) => row.filename === 'a.png' && row.id === 'lab'));

    const ghostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'del-facade-ghost-'));
    seedDeleteTree(ghostRoot, { files: { 'b.png': 'b' } });
    const ghostState = makeWorkspaceState();
    const ghostResources = makeDeleteHandlers(ghostRoot, { workspaceState: ghostState }).globalResources;
    const ghost = parseToolText(await _test.callTool(
        ghostResources,
        {
            authMethod: 'application_key',
            applicationKeyId: 'key-1',
            applicationAuth: { applicationScopes: ['gallery', 'workspace'], applicationKeyId: 'key-1' }
        },
        'delete_images',
        { filename: 'b.png', workspace: 'ghost' }
    ));
    assert.strictEqual(ghost.success, true);
    assert.ok(ghostState.scraps.some((row) => row.filename === 'b.png' && row.id === 'default'));
    assert.strictEqual(filenameHiddenByFakeDelete(ghostResources, 'b.png'), true);

    const names = [];
    collectPayloadFilenames({ shortcuts: [{ name: 'a.png', data: { filename: 'a.png' } }] }, names);
    assert.deepStrictEqual(names, ['a.png']);

    let hiddenStatus = 0;
    let hiddenBody = null;
    const blocked = await rejectAgentHiddenHttpFile(
        { authMethod: 'application_key' },
        {
            status(code) { hiddenStatus = code; return this; },
            json(payload) { hiddenBody = payload; }
        },
        globalResources,
        'a.png',
        'Image not found'
    );
    assert.strictEqual(blocked, true);
    assert.strictEqual(hiddenStatus, 404);
    assert.strictEqual(hiddenBody.error, 'Image not found');
}

function makeRealWorkspaceManager(root, extras) {
    fs.mkdirSync(path.join(root, 'images'), { recursive: true });
    const workspacesPath = path.join(root, 'workspaces.json');
    const flagged = new Set(extras && extras.flagged ? extras.flagged : []);
    const desktop = extras && extras.desktop ? extras.desktop : { default: { shortcuts: [] }, windowPositions: {} };
    const initial = {
        default: {
            name: 'Default',
            color: '#102040',
            sort: 0,
            files: ['a.png', 'keep.png'],
            scraps: [],
            hiddenByFakeDelete: [],
            pinned: ['pin.png'],
            presets: [],
            groups: {
                g1: {
                    id: 'g1',
                    name: 'Set',
                    images: ['a.png', 'keep.png', 'pin.png'],
                    createdAt: 1,
                    updatedAt: 1
                }
            }
        },
        ...(extras && extras.workspaces ? extras.workspaces : {})
    };
    fs.writeFileSync(workspacesPath, JSON.stringify(initial));
    let cache = JSON.parse(JSON.stringify(initial));
    const globalResources = {
        getPath(kind) {
            if (kind === 'workspaceFile') return workspacesPath;
            if (kind === 'images') return path.join(root, 'images');
            if (kind === 'cache') return path.join(root, 'cache');
            if (kind === 'uploadCache') return path.join(root, 'cache', 'upload');
            return root;
        },
        getWorkspacesConfig(opts) {
            if (opts && opts.path) {
                const segs = Array.isArray(opts.path) ? opts.path : [opts.path];
                let cur = cache;
                for (const seg of segs) {
                    if (!cur) return undefined;
                    cur = cur[seg];
                }
                return cur;
            }
            return opts && opts.clone ? JSON.parse(JSON.stringify(cache)) : cache;
        },
        setWorkspacesConfigCache(next) { cache = next; },
        saveConfig(type, data) {
            if (type === 'workspaces' && data) {
                cache = data;
                fs.writeFileSync(workspacesPath, JSON.stringify(data));
            }
        },
        getWorkspaceDesktopConfig() { return desktop; },
        getMetadataDatabase: () => {
            if (extras && extras.metadataDb) return extras.metadataDb;
            if (!flagged.size) return null;
            return {
                async isImageOrPairFlagged(filename) { return flagged.has(filename); },
                async isImageFlagged(filename) { return flagged.has(filename); },
                async listWorkspaceGalleryFilenames(workspaceId, bucket) {
                    const ws = cache[workspaceId] || {};
                    if (bucket === 'scraps') return (ws.scraps || []).slice();
                    return (ws.files || []).slice();
                }
            };
        },
        metadataDatabase: null,
        getDataPlumbing: () => ({ publish() {} }),
        getReferenceMetadataDatabase: () => ({
            deleteMetadata() {},
            getWorkspaceReferenceCounts() { return {}; },
            moveAllReferencesBetweenWorkspaces() { return 0; },
            moveAllVibesBetweenWorkspaces() { return 0; },
            getFileCacheForReferences() { return {}; },
            getWorkspaceReferencesAndVibesWithData() { return { cacheFiles: {}, vibes: {} }; }
        }),
        getNotesDatabase: () => null,
        getWebSocketServer: () => ({ broadcast() {} }),
        getVfsPathUuid: () => null
    };
    const wm = new WorkspaceManager(globalResources);
    globalResources.getWorkspaceManager = () => wm;
    return {
        wm,
        globalResources,
        workspacesPath,
        desktop,
        readSaved() { return JSON.parse(fs.readFileSync(workspacesPath, 'utf8')); }
    };
}

async function testRealWorkspaceManagerPersistsClear() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-clear-'));
    const { wm, workspacesPath, readSaved } = makeRealWorkspaceManager(root);
    wm.markHiddenByFakeDelete(['a.png'], 'default');
    assert.ok(readSaved().default.hiddenByFakeDelete.includes('a.png'));
    wm.addToWorkspaceArray('scraps', 'a.png', 'default');
    wm.removeFromWorkspaceArray('scraps', 'a.png', 'default', null, { clearHiddenByFakeDelete: true });
    const saved = JSON.parse(fs.readFileSync(workspacesPath, 'utf8'));
    assert.ok(!saved.default.hiddenByFakeDelete.includes('a.png'));
    assert.ok(saved.default.files.includes('a.png'));
}

async function testAgentUnscrapLeavesHidden() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-agent-unscrap-'));
    const { wm, globalResources, readSaved } = makeRealWorkspaceManager(root);
    wm.markHiddenByFakeDelete(['a.png'], 'default');
    wm.addToWorkspaceArray('scraps', 'a.png', 'default');
    const sent = [];
    const broadcasts = [];
    const handlers = {
        globalResources: {
            ...globalResources,
            getWorkspaceManager: () => wm,
            getMetadataDatabase: () => ({
                async isImageOrPairFlagged() { return false; },
                async isImageFlagged() { return false; }
            })
        },
        sendToClient(_ws, payload) { sent.push(payload); },
        sendError(_ws, message, details) { sent.push({ type: 'error', message, details }); }
    };
    const wsHandlers = new WorkspaceWebSocketHandlers(handlers);
    await wsHandlers.handleWorkspaceRemoveScrap(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-unscrap' },
        agentClient(),
        { broadcast(msg) { broadcasts.push(msg); } }
    );
    assert.strictEqual(sent[0].type, 'workspace_remove_scrap_response');
    assert.deepStrictEqual(sent[0].data, { success: true, message: 'File removed from scraps' });
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].type, 'workspace_updated');
    assert.deepStrictEqual(broadcasts[0].data, {
        action: 'scrap_removed',
        workspaceId: 'default',
        filename: 'a.png'
    });
    const saved = readSaved();
    assert.ok(saved.default.hiddenByFakeDelete.includes('a.png'));
    assert.ok(saved.default.scraps.includes('a.png'));
    assert.strictEqual(await agentCannotSeeFilename(handlers.globalResources, 'a.png'), true);

    wm.markHiddenByFakeDelete(['keep.png'], 'default');
    await wsHandlers.handleWorkspaceGetFiles(
        {},
        { id: 'default', requestId: 'r-files' },
        agentClient(),
        { broadcast() {} }
    );
    const filesReply = sent.find((row) => row.type === 'workspace_get_files_response');
    assert.ok(filesReply);
    assert.ok(!filesReply.data.files.includes('keep.png'));
    assert.ok(!filesReply.data.files.includes('a.png'));

    const listing = await filterFilenamesVisibleToClient(
        handlers.globalResources,
        ['keep.png', 'a.png', 'pin.png'],
        agentClient()
    );
    assert.deepStrictEqual(listing, ['pin.png']);
    const ownerListing = await filterFilenamesVisibleToClient(
        handlers.globalResources,
        ['keep.png', 'a.png', 'pin.png'],
        userClient()
    );
    assert.deepStrictEqual(ownerListing, ['keep.png', 'a.png', 'pin.png']);
}

function labWorkspaceRecord() {
    return {
        name: 'Lab',
        color: '#204060',
        sort: 1,
        files: ['hidden.png', 'visible.png'],
        scraps: ['hidden.png'],
        hiddenByFakeDelete: ['hidden.png'],
        pinned: [],
        presets: [],
        groups: {}
    };
}

function makeWorkspaceHandlers(globalResources, wm) {
    const sent = [];
    const broadcasts = [];
    const handlers = {
        globalResources: {
            ...globalResources,
            getWorkspaceManager: () => wm
        },
        sendToClient(_ws, payload) { sent.push(payload); },
        sendError(_ws, message, details) { sent.push({ type: 'error', message, details }); }
    };
    return {
        sent,
        broadcasts,
        wsHandlers: new WorkspaceWebSocketHandlers(handlers),
        wsServer: { broadcast(msg) { broadcasts.push(msg); } }
    };
}

async function testDumpAndDeleteCarryHiddenMarks() {
    const dumpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-dump-carry-'));
    const dump = makeRealWorkspaceManager(dumpRoot, { workspaces: { lab: labWorkspaceRecord() } });
    const dumpCount = await dump.wm.dumpWorkspace('lab', 'default');
    const dumped = dump.readSaved();
    assert.ok(!dumped.lab);
    assert.ok(dumped.default.files.includes('hidden.png'));
    assert.ok(dumped.default.files.includes('visible.png'));
    assert.ok(dumped.default.scraps.includes('hidden.png'));
    assert.ok(dumped.default.hiddenByFakeDelete.includes('hidden.png'));
    assert.ok(dumpCount >= 2);

    const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-dump-agent-'));
    const agent = makeRealWorkspaceManager(agentRoot, {
        workspaces: { lab: labWorkspaceRecord() },
        metadataDb: {
            async listGalleryWorkspacePinFilenames(workspaceId) {
                return workspaceId === 'lab' ? ['hidden.png'] : [];
            },
            async listWorkspaceGalleryFilenames(workspaceId, bucket) {
                const rec = workspaceId === 'lab' ? labWorkspaceRecord() : { files: [], scraps: [] };
                return bucket === 'scraps' ? rec.scraps.slice() : rec.files.slice();
            }
        }
    });
    const { sent, broadcasts, wsHandlers, wsServer } = makeWorkspaceHandlers(agent.globalResources, agent.wm);
    await wsHandlers.handleWorkspaceDump(
        {},
        { sourceId: 'lab', targetId: 'default', requestId: 'r-dump' },
        agentClient(),
        wsServer
    );
    const mainDumpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-dump-main-'));
    const mainLab = labWorkspaceRecord();
    mainLab.files = ['visible.png'];
    mainLab.scraps = [];
    mainLab.hiddenByFakeDelete = [];
    mainLab.pinned = [];
    const mainDump = makeRealWorkspaceManager(mainDumpRoot, { workspaces: { lab: mainLab } });
    const mainMoved = await mainDump.wm.dumpWorkspace('lab', 'default');
    assert.strictEqual(sent[0].type, 'workspace_dump_response');
    assert.strictEqual(sent[0].data.success, true);
    assert.strictEqual(sent[0].data.movedCount, mainMoved);
    assert.strictEqual(sent[0].data.movedCount, 1);
    const dumpBroadcast = broadcasts.find((row) => row.type === 'workspace_updated' && row.data.action === 'dumped');
    assert.ok(dumpBroadcast);
    assert.strictEqual(dumpBroadcast.data.movedCount, mainMoved);
    const agentSaved = agent.readSaved();
    assert.ok(!agentSaved.lab);
    assert.ok(agentSaved.default.files.includes('hidden.png'));
    assert.ok(agentSaved.default.files.includes('visible.png'));
    assert.ok(agentSaved.default.hiddenByFakeDelete.includes('hidden.png'));

    const delRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-del-carry-'));
    const del = makeRealWorkspaceManager(delRoot, { workspaces: { lab: labWorkspaceRecord() } });
    await del.wm.deleteWorkspace('lab');
    const deleted = del.readSaved();
    assert.ok(!deleted.lab);
    assert.ok(deleted.default.files.includes('hidden.png'));
    assert.ok(deleted.default.files.includes('visible.png'));
    assert.ok(deleted.default.hiddenByFakeDelete.includes('hidden.png'));
}

async function testRemoveFilesFromWorkspacesClearsHidden() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-remove-files-'));
    const { wm, readSaved } = makeRealWorkspaceManager(root);
    wm.markHiddenByFakeDelete(['a.png'], 'default');
    wm.addToWorkspaceArray('scraps', 'a.png', 'default');
    assert.ok(readSaved().default.hiddenByFakeDelete.includes('a.png'));
    const removed = wm.removeFilesFromWorkspaces(['a.png']);
    assert.ok(removed > 0);
    const saved = readSaved();
    assert.ok(!saved.default.hiddenByFakeDelete.includes('a.png'));
}

async function testOwnerVfsRestoreClearsMark() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-vfs-restore-'));
    const { wm, globalResources, readSaved } = makeRealWorkspaceManager(root);
    wm.markHiddenByFakeDelete(['a.png'], 'default');
    wm.addToWorkspaceArray('scraps', 'a.png', 'default');
    const vfs = new VfsManager(globalResources);
    await vfs._removeVirtualSurfaceFromSource(
        { targetKind: 'scrap', targetId: 'a.png', workspaceId: 'default' },
        { clientInfo: userClient() }
    );
    const ownerSaved = readSaved();
    assert.ok(!ownerSaved.default.hiddenByFakeDelete.includes('a.png'));
    assert.ok(!ownerSaved.default.scraps.includes('a.png'));

    wm.markHiddenByFakeDelete(['keep.png'], 'default');
    wm.addToWorkspaceArray('scraps', 'keep.png', 'default');
    await vfs._removeVirtualSurfaceFromSource(
        { targetKind: 'scrap', targetId: 'keep.png', workspaceId: 'default' },
        { clientInfo: agentClient() }
    );
    const agentSaved = readSaved();
    assert.ok(agentSaved.default.hiddenByFakeDelete.includes('keep.png'));
    assert.ok(agentSaved.default.scraps.includes('keep.png'));
}

async function testBulkUnscrapBroadcastParity() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-bulk-unscrap-'));
    const { wm, globalResources, readSaved } = makeRealWorkspaceManager(root);
    wm.markHiddenByFakeDelete(['a.png'], 'default');
    wm.addToWorkspaceArray('scraps', 'a.png', 'default');
    const { sent, broadcasts, wsHandlers, wsServer } = makeWorkspaceHandlers(globalResources, wm);
    await wsHandlers.handleWorkspaceBulkRemoveScrap(
        {},
        { id: 'default', filenames: ['a.png'], requestId: 'r-bulk' },
        agentClient(),
        wsServer
    );
    assert.strictEqual(sent[0].type, 'workspace_bulk_remove_scrap_response');
    assert.deepStrictEqual(sent[0].data, { success: true, removedCount: 1 });
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].type, 'workspace_updated');
    assert.deepStrictEqual(broadcasts[0].data, {
        action: 'bulk_remove_scrap',
        workspaceId: 'default',
        removedCount: 1
    });
    const saved = readSaved();
    assert.ok(saved.default.hiddenByFakeDelete.includes('a.png'));
    assert.ok(saved.default.scraps.includes('a.png'));
}

async function testListingFiltersOmitHidden() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-list-filter-'));
    const { wm, globalResources } = makeRealWorkspaceManager(root, { flagged: ['flagged.png'] });
    wm.markHiddenByFakeDelete(['a.png'], 'default');
    const { sent, wsHandlers, wsServer } = makeWorkspaceHandlers(globalResources, wm);

    await wsHandlers.handleWorkspaceGetGroups({}, { id: 'default', requestId: 'r-groups' }, agentClient(), wsServer);
    const groupsReply = sent.find((row) => row.type === 'workspace_get_groups_response');
    assert.ok(groupsReply);
    assert.deepStrictEqual(groupsReply.data.groups[0].images, ['keep.png', 'pin.png']);

    sent.length = 0;
    await wsHandlers.handleWorkspaceGetGroups({}, { id: 'default', requestId: 'r-groups-owner' }, userClient(), wsServer);
    const ownerGroups = sent.find((row) => row.type === 'workspace_get_groups_response');
    assert.deepStrictEqual(ownerGroups.data.groups[0].images, ['a.png', 'keep.png', 'pin.png']);

    sent.length = 0;
    await wsHandlers.handleWorkspaceGetGroup(
        {},
        { id: 'default', groupId: 'g1', requestId: 'r-group' },
        agentClient(),
        wsServer
    );
    assert.deepStrictEqual(sent[0].data.group.images, ['keep.png', 'pin.png']);

    sent.length = 0;
    await wsHandlers.handleWorkspaceGetImageGroups(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-img-groups' },
        agentClient(),
        wsServer
    );
    assert.deepStrictEqual(sent[0].data.groups, []);

    sent.length = 0;
    await wsHandlers.handleWorkspaceGetImageGroups(
        {},
        { id: 'default', filename: 'keep.png', requestId: 'r-img-groups-keep' },
        agentClient(),
        wsServer
    );
    assert.strictEqual(sent[0].data.groups.length, 1);
    assert.deepStrictEqual(sent[0].data.groups[0].images, ['keep.png', 'pin.png']);

    const desktopData = {
        shortcuts: [
            { id: 's1', name: 'a.png', data: { filename: 'a.png' } },
            { id: 's2', name: 'keep.png', data: { filename: 'keep.png' } },
            { id: 's3', name: 'flagged.png', data: { filename: 'flagged.png' } }
        ],
        windowPositions: { studio: { x: 1 } }
    };
    globalResources.getWorkspaceDesktopConfig = () => ({ default: desktopData, windowPositions: desktopData.windowPositions });
    const deskSent = [];
    const deskCtx = {
        globalResources,
        sendToClient(_ws, payload) { deskSent.push(payload); },
        sendError(_ws, message, details) { deskSent.push({ type: 'error', message, details }); }
    };
    await WebSocketMessageHandlers.prototype.handleDesktopGetShortcuts.call(
        deskCtx,
        {},
        { workspaceId: 'default', requestId: 'r-desk' },
        agentClient(),
        { broadcast() {} }
    );
    assert.strictEqual(deskSent[0].type, 'desktop_get_shortcuts_response');
    assert.deepStrictEqual(deskSent[0].data.shortcuts.map((row) => row.id), ['s2']);
    deskSent.length = 0;
    await WebSocketMessageHandlers.prototype.handleDesktopGetShortcuts.call(
        deskCtx,
        {},
        { workspaceId: 'default', requestId: 'r-desk-owner' },
        userClient(),
        { broadcast() {} }
    );
    assert.strictEqual(deskSent[0].data.shortcuts.length, 3);

    const imagesDir = path.join(root, 'images');
    const sizeByName = {
        'a.png': 11,
        'keep.png': 23,
        'keep_upscaled.png': 29,
        'flagged.png': 37
    };
    for (const [name, bytes] of Object.entries(sizeByName)) {
        fs.writeFileSync(path.join(imagesDir, name), Buffer.alloc(bytes, 1));
    }
    const defaultWs = wm.getWorkspace('default');
    if (!defaultWs.files.includes('keep_upscaled.png')) defaultWs.files.push('keep_upscaled.png');
    assert.strictEqual(countPairedGalleryFilenames(['keep.png', 'keep_upscaled.png']), 1);

    const vfsItems = [
        { name: 'a.png', targetKind: 'scrap', targetId: 'a.png', previewImageFilename: 'a.png' },
        { name: 'keep.png', targetKind: 'scrap', targetId: 'keep.png', previewImageFilename: 'keep.png' },
        { name: 'flagged.png', targetKind: 'image', targetId: 'flagged.png', previewImageFilename: 'flagged.png' }
    ];
    const agentVfs = await filterVfsListItemsVisibleToClient(globalResources, vfsItems, agentClient());
    assert.deepStrictEqual(agentVfs.map((row) => row.name), ['keep.png']);
    const ownerVfs = await filterVfsListItemsVisibleToClient(globalResources, vfsItems, userClient());
    assert.strictEqual(ownerVfs.length, 3);

    const vfsDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-db-'));
    assert.strictEqual(await vfsDatabase.initializeVfsDatabase(vfsDbDir), true);
    const vfsSent = [];
    const vfsManager = new VfsManager(globalResources);
    globalResources.getVfsManager = () => vfsManager;
    const vfsHandlers = new VfsWebSocketHandlers({
        globalResources,
        sendToClient(_ws, payload) { vfsSent.push(payload); },
        sendError(_ws, message, details) { vfsSent.push({ type: 'error', message, details }); }
    });
    const picturesPath = '/Workspaces/default/Pictures';
    await vfsHandlers.handleVfsListDirectory(
        {},
        { path: picturesPath, requestId: 'r-vfs', limit: 1 },
        agentClient()
    );
    assert.strictEqual(vfsSent[0].type, 'vfs_list_directory_response');
    assert.deepStrictEqual(vfsSent[0].data.items.map((row) => row.name), ['keep.png']);
    assert.strictEqual(vfsSent[0].data.totalCount, 2);
    assert.strictEqual(vfsSent[0].data.items.length, 1);
    assert.strictEqual(vfsSent[0].data.totalSizeBytes, sizeByName['keep.png'] + sizeByName['keep_upscaled.png']);

    vfsSent.length = 0;
    await vfsHandlers.handleVfsListDirectory(
        {},
        { path: picturesPath, requestId: 'r-vfs-page2', offset: 1, limit: 1 },
        agentClient()
    );
    assert.strictEqual(vfsSent[0].data.totalCount, 2);
    assert.deepStrictEqual(vfsSent[0].data.items.map((row) => row.name), ['keep_upscaled.png']);
    assert.strictEqual(vfsSent[0].data.totalSizeBytes, sizeByName['keep.png'] + sizeByName['keep_upscaled.png']);

    vfsSent.length = 0;
    await vfsHandlers.handleVfsListDirectory({}, { path: picturesPath, requestId: 'r-vfs-owner' }, userClient());
    assert.strictEqual(vfsSent[0].data.items.length, 3);
    assert.strictEqual(vfsSent[0].data.totalCount, 3);
    assert.strictEqual(
        vfsSent[0].data.totalSizeBytes,
        sizeByName['a.png'] + sizeByName['keep.png'] + sizeByName['keep_upscaled.png']
    );

    vfsSent.length = 0;
    await vfsHandlers.handleVfsGetPathStats({}, { path: picturesPath, requestId: 'r-stat' }, agentClient());
    assert.strictEqual(vfsSent[0].data.stats.itemCount, 2);
    assert.strictEqual(vfsSent[0].data.stats.totalSizeBytes, sizeByName['keep.png'] + sizeByName['keep_upscaled.png']);
    vfsSent.length = 0;
    await vfsHandlers.handleVfsGetPathStats({}, { path: picturesPath, requestId: 'r-stat-owner' }, userClient());
    assert.strictEqual(vfsSent[0].data.stats.itemCount, 3);
    assert.strictEqual(
        vfsSent[0].data.stats.totalSizeBytes,
        sizeByName['a.png'] + sizeByName['keep.png'] + sizeByName['keep_upscaled.png']
    );
    await vfsDatabase.closeVfsDatabase();

    const groups = await filterGroupsVisibleToClient(
        globalResources,
        [{ id: 'g1', images: ['a.png', 'keep.png', 'flagged.png'] }],
        agentClient()
    );
    assert.deepStrictEqual(groups[0].images, ['keep.png']);

    sent.length = 0;
    await wsHandlers.handleWorkspaceList({}, { requestId: 'r-list' }, agentClient(), wsServer);
    const listReply = sent.find((row) => row.type === 'workspace_list_response');
    const defaultRow = listReply.data.workspaces.find((row) => row.id === 'default');
    assert.strictEqual(defaultRow.fileCount, 1);
    sent.length = 0;
    await wsHandlers.handleWorkspaceList({}, { requestId: 'r-list-owner' }, userClient(), wsServer);
    const ownerList = sent.find((row) => row.type === 'workspace_list_response');
    const ownerDefault = ownerList.data.workspaces.find((row) => row.id === 'default');
    assert.strictEqual(ownerDefault.fileCount, 3);

    sent.length = 0;
    await wsHandlers.handleWorkspaceGet({}, { requestId: 'r-get' }, agentClient(), wsServer);
    assert.strictEqual(sent[0].data.fileCount, 1);
    sent.length = 0;
    await wsHandlers.handleWorkspaceGet({}, { requestId: 'r-get-owner' }, userClient(), wsServer);
    assert.strictEqual(sent[0].data.fileCount, 3);
}

function makeGalleryLookupHandlers(globalResources) {
    const sent = [];
    const wm = globalResources.getWorkspaceManager();
    return {
        sent,
        handlers: {
            globalResources: {
                ...globalResources,
                getWorkspaceManager: () => wm,
                getReplicationService: () => ({ getReplicationConfig: () => ({}) }),
                getMetadataDatabase: () => {
                    const existing = typeof globalResources.getMetadataDatabase === 'function'
                        ? globalResources.getMetadataDatabase()
                        : null;
                    return {
                        ...(existing || {}),
                        async findGalleryWorkspaceItemIndex() { return -1; },
                        async getCachedMetadata() { return null; },
                        async getImageMetadata() { return null; },
                        async isImageOrPairFlagged(filename) {
                            if (existing && typeof existing.isImageOrPairFlagged === 'function') {
                                return existing.isImageOrPairFlagged(filename);
                            }
                            return false;
                        },
                        async isImageFlagged(filename) {
                            if (existing && typeof existing.isImageFlagged === 'function') {
                                return existing.isImageFlagged(filename);
                            }
                            return false;
                        }
                    };
                },
                getPath(kind) {
                    if (typeof globalResources.getPath === 'function') return globalResources.getPath(kind);
                    return '/tmp';
                }
            },
            metadataCache: {
                trackClientWorkspace() {},
                get() { return null; },
                set() {}
            },
            sendToClient(_ws, payload) { sent.push(payload); },
            sendError(_ws, message, details, requestId) {
                sent.push({ type: 'error', message, details, requestId });
            }
        }
    };
}

async function testFakeDeletedMatchesRealDeleteTells() {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-fake-'));
    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-real-'));
    seedDeleteTree(fakeRoot);
    seedDeleteTree(realRoot);
    const fake = makeRealWorkspaceManager(fakeRoot);
    const real = makeRealWorkspaceManager(realRoot);
    fake.wm.markHiddenByFakeDelete(['a.png'], 'default');
    fake.wm.addToWorkspaceArray('scraps', 'a.png', 'default');
    assert.ok(fs.existsSync(path.join(fakeRoot, 'images', 'a.png')));
    real.wm.removeFilesFromWorkspaces(['a.png']);
    fs.unlinkSync(path.join(realRoot, 'images', 'a.png'));
    if (fs.existsSync(path.join(realRoot, 'images', 'a_upscaled.png'))) {
        fs.unlinkSync(path.join(realRoot, 'images', 'a_upscaled.png'));
    }

    const fakeLookup = makeGalleryLookupHandlers(fake.globalResources);
    const realLookup = makeGalleryLookupHandlers(real.globalResources);
    await handleImageMetadataRequest(
        fakeLookup.handlers, {}, { filename: 'a.png', requestId: 'r-meta-fake' }, agentClient(), {}
    );
    await handleImageMetadataRequest(
        realLookup.handlers, {}, { filename: 'a.png', requestId: 'r-meta-real' }, userClient(), {}
    );
    assert.strictEqual(fakeLookup.sent[0].type, 'error');
    assert.strictEqual(fakeLookup.sent[0].message, 'Image not found');
    assert.strictEqual(realLookup.sent[0].type, 'error');
    assert.strictEqual(realLookup.sent[0].message, 'Image not found');
    assert.ok(!fakeLookup.sent[0].data || !fakeLookup.sent[0].data.underReview);

    fakeLookup.sent.length = 0;
    realLookup.sent.length = 0;
    await handleFindImageIndexRequest(
        fakeLookup.handlers, {}, { filename: 'a.png', requestId: 'r-idx-fake' }, agentClient(), {}
    );
    await handleFindImageIndexRequest(
        realLookup.handlers, {}, { filename: 'a.png', requestId: 'r-idx-real' }, userClient(), {}
    );
    assert.deepStrictEqual(fakeLookup.sent[0].data, { index: -1 });
    assert.deepStrictEqual(realLookup.sent[0].data, { index: -1 });
    assert.ok(!('underReview' in fakeLookup.sent[0].data));

    const flaggedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tell-flag-'));
    seedDeleteTree(flaggedRoot);
    const flagged = makeRealWorkspaceManager(flaggedRoot, { flagged: ['a.png'] });
    const flagLookup = makeGalleryLookupHandlers(flagged.globalResources);
    await handleImageMetadataRequest(
        flagLookup.handlers, {}, { filename: 'a.png', requestId: 'r-meta-flag' }, agentClient(), {}
    );
    assert.strictEqual(flagLookup.sent[0].error, UNDER_REVIEW_ERROR);
    flagLookup.sent.length = 0;
    await handleFindImageIndexRequest(
        flagLookup.handlers, {}, { filename: 'a.png', requestId: 'r-idx-flag' }, agentClient(), {}
    );
    assert.strictEqual(flagLookup.sent[0].data.underReview, true);

    const fakeWs = makeWorkspaceHandlers(fake.globalResources, fake.wm);
    const realWs = makeWorkspaceHandlers(real.globalResources, real.wm);
    await fakeWs.wsHandlers.handleWorkspaceBulkAddScrap(
        {},
        { id: 'default', filenames: ['a.png'], requestId: 'r-add-fake' },
        agentClient(),
        fakeWs.wsServer
    );
    await realWs.wsHandlers.handleWorkspaceBulkAddScrap(
        {},
        { id: 'default', filenames: ['a.png'], requestId: 'r-add-real' },
        userClient(),
        realWs.wsServer
    );
    assert.deepStrictEqual(fakeWs.sent[0].data, realWs.sent[0].data);
    assert.deepStrictEqual(fakeWs.broadcasts[0].data, realWs.broadcasts[0].data);
    assert.ok(fake.readSaved().default.hiddenByFakeDelete.includes('a.png'));

    fakeWs.sent.length = 0;
    fakeWs.broadcasts.length = 0;
    realWs.sent.length = 0;
    realWs.broadcasts.length = 0;
    await fakeWs.wsHandlers.handleWorkspaceAddPinned(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-pin-fake' },
        agentClient(),
        fakeWs.wsServer
    );
    await realWs.wsHandlers.handleWorkspaceAddPinned(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-pin-real' },
        userClient(),
        realWs.wsServer
    );
    assert.deepStrictEqual(fakeWs.sent[0].data, realWs.sent[0].data);
    assert.deepStrictEqual(fakeWs.broadcasts[0].data, realWs.broadcasts[0].data);
    assert.ok(!fake.readSaved().default.pinned.includes('a.png'));

    assert.strictEqual(filenameHiddenByFakeDelete(fake.globalResources, 'a.png'), true);
    assert.ok(!fs.existsSync(path.join(realRoot, 'images', 'a.png')));
    const resolveReq = {
        authMethod: 'application_key',
        applicationKeyId: 'key-1',
        applicationAuth: { applicationScopes: ['gallery', 'search', 'workspace'], applicationKeyId: 'key-1' }
    };
    const lookedFake = await _test.resolveGalleryFilename(fake.globalResources, resolveReq, { filename: 'a.png' });
    assert.strictEqual(lookedFake.filename, null);
    assert.ok(!lookedFake.underReview);

    const lumenFake = parseToolText(await _test.callTool(
        {
            ...fake.globalResources,
            getWebSocketServer: () => ({ broadcast() { return true; }, hasConnectedClients() { return true; } })
        },
        {
            authMethod: 'application_key',
            applicationKeyId: 'key-1',
            applicationAuth: { applicationScopes: ['gallery', 'workspace'], applicationKeyId: 'key-1' }
        },
        'open_in_lumen',
        { filename: 'a.png' }
    ));
    const lumenReal = parseToolText(await _test.callTool(
        {
            ...real.globalResources,
            getWebSocketServer: () => ({ broadcast() { return true; }, hasConnectedClients() { return true; } })
        },
        {
            authMethod: 'application_key',
            applicationKeyId: 'key-1',
            applicationAuth: { applicationScopes: ['gallery', 'workspace'], applicationKeyId: 'key-1' }
        },
        'open_in_lumen',
        { filename: 'a.png' }
    ));
    assert.strictEqual(lumenFake.underReview, undefined);
    assert.strictEqual(lumenFake.success, lumenReal.success);
}

async function testFacadeScrapImagesRemoveFakeDeleted() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-facade-scrap-'));
    const { wm, globalResources } = makeRealWorkspaceManager(root, { flagged: ['flagged.png'] });
    wm.markHiddenByFakeDelete(['a.png'], 'default');
    assert.strictEqual(await filenameIsModerationFlagged(globalResources, 'a.png'), false);
    assert.strictEqual(await agentCannotSeeFilename(globalResources, 'a.png'), true);
    assert.strictEqual(await filenameIsModerationFlagged(globalResources, 'flagged.png'), true);

    const flagged = parseToolText(await _test.callTool(
        globalResources,
        {
            authMethod: 'application_key',
            applicationKeyId: 'key-1',
            applicationAuth: { applicationScopes: ['gallery', 'workspace'], applicationKeyId: 'key-1' }
        },
        'scrap_images',
        { filename: 'flagged.png', remove: true }
    ));
    assert.strictEqual(flagged.success, false);
    assert.strictEqual(flagged.underReview, true);
    assert.strictEqual(flagged.error, UNDER_REVIEW_ERROR);

    const { sent, broadcasts, wsHandlers, wsServer } = makeWorkspaceHandlers(globalResources, wm);
    await wsHandlers.handleWorkspaceRemoveScrap(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-facade-unscrap' },
        agentClient(),
        wsServer
    );
    assert.deepStrictEqual(sent[0].data, { success: true, message: 'File removed from scraps' });
    assert.strictEqual(broadcasts[0].type, 'workspace_updated');
    assert.strictEqual(broadcasts[0].data.action, 'scrap_removed');
}

function galleryOwnerSnapshot(wm, workspaceId) {
    const rec = wm.getWorkspace(workspaceId) || {};
    return {
        files: (rec.files || []).slice(),
        scraps: (rec.scraps || []).slice(),
        pinned: (rec.pinned || []).slice(),
        hiddenByFakeDelete: (rec.hiddenByFakeDelete || []).slice()
    };
}

async function toggleFavoriteOnce(wsHandlers, wsServer, filename, pinned) {
    const isPinned = pinned.includes(filename);
    const wantPinned = !isPinned;
    const method = wantPinned ? 'handleWorkspaceAddPinned' : 'handleWorkspaceRemovePinned';
    await wsHandlers[method](
        {},
        { id: 'default', filename, requestId: `r-fav-${wantPinned ? 'on' : 'off'}` },
        agentClient(),
        wsServer
    );
    return wantPinned;
}

async function runAgentNoopSequences(label, harness, filename) {
    const { wm, globalResources, ws, readSaved } = harness;
    const before = galleryOwnerSnapshot(wm, 'default');
    assert.strictEqual(await agentShouldNoopGalleryName(globalResources, filename), true);

    await toggleFavoriteOnce(ws.wsHandlers, ws.wsServer, filename, wm.getWorkspace('default').pinned || []);
    const afterFirstToggle = galleryOwnerSnapshot(wm, 'default');
    assert.deepStrictEqual(afterFirstToggle, before, `${label} toggle 1 mutated owner`);
    assert.deepStrictEqual(ws.sent[0].data, { success: true, message: 'File added to pinned' });
    assert.deepStrictEqual(ws.broadcasts[0].data, {
        action: 'pinned_added',
        workspaceId: 'default',
        filename
    });

    ws.sent.length = 0;
    ws.broadcasts.length = 0;
    await toggleFavoriteOnce(ws.wsHandlers, ws.wsServer, filename, wm.getWorkspace('default').pinned || []);
    assert.deepStrictEqual(galleryOwnerSnapshot(wm, 'default'), before, `${label} toggle 2 mutated owner`);
    assert.deepStrictEqual(ws.sent[0].data, { success: true, message: 'File added to pinned' });
    assert.deepStrictEqual(ws.broadcasts[0].data, {
        action: 'pinned_added',
        workspaceId: 'default',
        filename
    });

    ws.sent.length = 0;
    ws.broadcasts.length = 0;
    await ws.wsHandlers.handleWorkspaceAddScrap(
        {},
        { id: 'default', filename, requestId: 'r-add-scrap' },
        agentClient(),
        ws.wsServer
    );
    assert.deepStrictEqual(ws.sent[0].data, { success: true, message: 'File added to scraps' });
    assert.deepStrictEqual(ws.broadcasts[0].data, {
        action: 'scrap_added',
        workspaceId: 'default',
        filename
    });
    assert.deepStrictEqual(galleryOwnerSnapshot(wm, 'default'), before, `${label} add scrap mutated owner`);

    ws.sent.length = 0;
    await ws.wsHandlers.handleWorkspaceGetScraps(
        {},
        { id: 'default', requestId: 'r-list-scraps' },
        agentClient(),
        ws.wsServer
    );
    assert.ok(!ws.sent[0].data.scraps.includes(filename), `${label} list scraps leaked ${filename}`);

    ws.sent.length = 0;
    ws.broadcasts.length = 0;
    await ws.wsHandlers.handleWorkspaceBulkAddScrap(
        {},
        { id: 'default', filenames: [filename], requestId: 'r-bulk-scrap' },
        agentClient(),
        ws.wsServer
    );
    assert.deepStrictEqual(ws.sent[0].data, { success: true, addedCount: 1 });
    assert.deepStrictEqual(ws.broadcasts[0].data, {
        action: 'bulk_add_scrap',
        workspaceId: 'default',
        addedCount: 1
    });

    ws.sent.length = 0;
    ws.broadcasts.length = 0;
    await ws.wsHandlers.handleWorkspaceRemovePinned(
        {},
        { id: 'default', filename, requestId: 'r-unpin' },
        agentClient(),
        ws.wsServer
    );
    assert.deepStrictEqual(ws.sent[0].data, { success: true, message: 'File removed from pinned' });
    assert.deepStrictEqual(ws.broadcasts[0].data, {
        action: 'pinned_removed',
        workspaceId: 'default',
        filename
    });
    assert.deepStrictEqual(readSaved().default.scraps, before.scraps);
    assert.deepStrictEqual(readSaved().default.pinned, before.pinned);
    return { before, sent: ws.sent.slice(), broadcasts: ws.broadcasts.slice() };
}

async function testAgentMissingAndHiddenMutationsNoop() {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-noop-fake-'));
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-noop-miss-'));
    const fake = makeRealWorkspaceManager(fakeRoot);
    const missing = makeRealWorkspaceManager(missingRoot);
    fs.writeFileSync(path.join(fakeRoot, 'images', 'a.png'), 'orig');
    fs.writeFileSync(path.join(fakeRoot, 'images', 'keep.png'), 'keep');
    fs.writeFileSync(path.join(missingRoot, 'images', 'keep.png'), 'keep');
    fake.wm.markHiddenByFakeDelete(['a.png'], 'default');
    assert.ok(fs.existsSync(path.join(fakeRoot, 'images', 'a.png')));
    assert.ok(!fs.existsSync(path.join(missingRoot, 'images', 'a.png')));
    assert.strictEqual(await agentShouldNoopGalleryName(fake.globalResources, 'a.png'), true);
    assert.strictEqual(await agentShouldNoopGalleryName(missing.globalResources, 'a.png'), true);
    assert.strictEqual(await agentShouldNoopGalleryName(fake.globalResources, 'keep.png'), false);

    const fakeWs = makeWorkspaceHandlers(fake.globalResources, fake.wm);
    const missingWs = makeWorkspaceHandlers(missing.globalResources, missing.wm);
    const fakeRun = await runAgentNoopSequences('hidden', {
        wm: fake.wm,
        globalResources: fake.globalResources,
        ws: fakeWs,
        readSaved: fake.readSaved
    }, 'a.png');
    const missingRun = await runAgentNoopSequences('missing', {
        wm: missing.wm,
        globalResources: missing.globalResources,
        ws: missingWs,
        readSaved: missing.readSaved
    }, 'a.png');
    assert.deepStrictEqual(fakeRun.before.scraps, missingRun.before.scraps);
    assert.deepStrictEqual(fake.readSaved().default.scraps, missing.readSaved().default.scraps);
    assert.deepStrictEqual(fake.readSaved().default.pinned, missing.readSaved().default.pinned);
    assert.ok(!fake.readSaved().default.scraps.includes('a.png'));
    assert.ok(!missing.readSaved().default.scraps.includes('a.png'));
    assert.ok(!fake.readSaved().default.pinned.includes('a.png'));
    assert.ok(!missing.readSaved().default.pinned.includes('a.png'));

    const ownerMissing = makeRealWorkspaceManager(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-noop-owner-')));
    const ownerWs = makeWorkspaceHandlers(ownerMissing.globalResources, ownerMissing.wm);
    await ownerWs.wsHandlers.handleWorkspaceAddScrap(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-owner-ghost' },
        userClient(),
        ownerWs.wsServer
    );
    assert.deepStrictEqual(ownerWs.sent[0].data, { success: true, message: 'File added to scraps' });
    assert.ok(ownerMissing.readSaved().default.scraps.includes('a.png'));
}

async function insertImageRowForTest(databasesPath, filename, extras = {}) {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    const conn = await open({
        filename: path.join(databasesPath, 'metadata.db'),
        driver: sqlite3.Database
    });
    try {
        await conn.run(
            `INSERT OR IGNORE INTO images (filename, md5, width, height, metadata)
             VALUES (?, ?, ?, ?, ?)`,
            [
                filename,
                extras.md5 || 'test',
                extras.width || 1,
                extras.height || 1,
                JSON.stringify(extras.metadata || {})
            ]
        );
        if (extras.workspaceId) {
            await conn.run('PRAGMA foreign_keys = OFF');
            await conn.run(
                `INSERT OR REPLACE INTO gallery_workspace_ownership
                 (filename, workspace_id, bucket, created_at) VALUES (?, ?, ?, strftime('%s', 'now'))`,
                [filename, extras.workspaceId, extras.bucket || 'files']
            );
        }
    } finally {
        await conn.close();
    }
}

function attachWorkspacePackets(globalResources) {
    const sent = [];
    const broadcasts = [];
    const writeSink = (ws, payload) => {
        sent.push(payload);
        if (ws && ws.readyState === 1 && typeof ws.send === 'function') {
            ws.send(JSON.stringify(payload));
        }
    };
    const handlersCtx = {
        globalResources,
        // sendToClient: modules/websocketHandlers.js — facade sink captures via ws.send
        sendToClient(ws, payload) { writeSink(ws, payload); },
        sendError(ws, message, details, requestId) {
            writeSink(ws, { type: 'error', message, details, requestId });
        },
        isDestructiveOperation() { return false; }
    };
    globalResources.getWebSocketMessageHandlers = () => handlersCtx;
    globalResources.getWebSocketServer = () => ({
        broadcast(msg) { broadcasts.push(msg); },
        hasConnectedClients() { return true; }
    });
    registerWorkspacePackets(handlersCtx);
    return { sent, broadcasts };
}

function facadeAgentReq() {
    return {
        authMethod: 'application_key',
        applicationKeyId: 'key-1',
        applicationAuth: { applicationScopes: ['gallery', 'workspace'], applicationKeyId: 'key-1' }
    };
}

function dropNameFromFiles(wm, filename) {
    const rec = wm.getWorkspace('default');
    rec.files = (rec.files || []).filter((name) => name !== filename);
}

async function testAgentUnscrapThenGetFilesFakeVsReal() {
    const fake = makeRealWorkspaceManager(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-unscrap-fake-')));
    fs.writeFileSync(path.join(fake.globalResources.getPath('images'), 'a.png'), 'orig');
    fake.wm.markHiddenByFakeDelete(['a.png'], 'default');
    fake.wm.addToWorkspaceArray('scraps', 'a.png', 'default');
    const fakeWs = makeWorkspaceHandlers(fake.globalResources, fake.wm);
    await fakeWs.wsHandlers.handleWorkspaceRemoveScrap(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-unscrap-fake' },
        agentClient(),
        fakeWs.wsServer
    );
    fakeWs.sent.length = 0;
    await fakeWs.wsHandlers.handleWorkspaceGetFiles(
        {},
        { id: 'default', requestId: 'r-files-fake' },
        agentClient(),
        fakeWs.wsServer
    );
    const fakeFiles = fakeWs.sent[0].data.files;
    assert.ok(!fakeFiles.includes('a.png'));
    assert.ok(!fake.wm.getWorkspace('default').files.includes('a.png'));

    const real = makeRealWorkspaceManager(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-unscrap-real-')));
    dropNameFromFiles(real.wm, 'a.png');
    const realWs = makeWorkspaceHandlers(real.globalResources, real.wm);
    await realWs.wsHandlers.handleWorkspaceRemoveScrap(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-unscrap-real' },
        agentClient(),
        realWs.wsServer
    );
    realWs.sent.length = 0;
    await realWs.wsHandlers.handleWorkspaceGetFiles(
        {},
        { id: 'default', requestId: 'r-files-real' },
        agentClient(),
        realWs.wsServer
    );
    assert.deepStrictEqual(realWs.sent[0].data.files, fakeFiles);
    assert.ok(!real.wm.getWorkspace('default').files.includes('a.png'));

    realWs.sent.length = 0;
    realWs.broadcasts.length = 0;
    await realWs.wsHandlers.handleWorkspaceBulkRemoveScrap(
        {},
        { id: 'default', filenames: ['a.png'], requestId: 'r-bulk-unscrap-real' },
        agentClient(),
        realWs.wsServer
    );
    assert.ok(!real.wm.getWorkspace('default').files.includes('a.png'));

    const vfs = new VfsManager(real.globalResources);
    await vfs._removeVirtualSurfaceFromSource(
        { targetKind: 'scrap', targetId: 'a.png', workspaceId: 'default' },
        { clientInfo: agentClient() }
    );
    assert.ok(!real.wm.getWorkspace('default').files.includes('a.png'));

    const owner = makeRealWorkspaceManager(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-unscrap-owner-')));
    dropNameFromFiles(owner.wm, 'a.png');
    const ownerWs = makeWorkspaceHandlers(owner.globalResources, owner.wm);
    await ownerWs.wsHandlers.handleWorkspaceRemoveScrap(
        {},
        { id: 'default', filename: 'a.png', requestId: 'r-unscrap-owner' },
        userClient(),
        ownerWs.wsServer
    );
    assert.ok(owner.wm.getWorkspace('default').files.includes('a.png'));

    const facadeFake = makeRealWorkspaceManager(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-unscrap-fface-')));
    fs.writeFileSync(path.join(facadeFake.globalResources.getPath('images'), 'a.png'), 'orig');
    facadeFake.wm.markHiddenByFakeDelete(['a.png'], 'default');
    facadeFake.wm.addToWorkspaceArray('scraps', 'a.png', 'default');
    attachWorkspacePackets(facadeFake.globalResources);
    const facadeFakeUnscrap = parseToolText(await _test.callTool(
        facadeFake.globalResources,
        facadeAgentReq(),
        'scrap_images',
        { filename: 'a.png', remove: true }
    ));
    assert.strictEqual(facadeFakeUnscrap.success, true);
    const facadeFakeWs = makeWorkspaceHandlers(facadeFake.globalResources, facadeFake.wm);
    await facadeFakeWs.wsHandlers.handleWorkspaceGetFiles(
        {},
        { id: 'default', requestId: 'r-files-fface' },
        agentClient(),
        facadeFakeWs.wsServer
    );
    assert.ok(!facadeFakeWs.sent[0].data.files.includes('a.png'));
    assert.ok(!facadeFake.wm.getWorkspace('default').files.includes('a.png'));

    const facadeReal = makeRealWorkspaceManager(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-unscrap-rface-')));
    dropNameFromFiles(facadeReal.wm, 'a.png');
    attachWorkspacePackets(facadeReal.globalResources);
    const facadeRealUnscrap = parseToolText(await _test.callTool(
        facadeReal.globalResources,
        facadeAgentReq(),
        'scrap_images',
        { filename: 'a.png', remove: true }
    ));
    assert.strictEqual(facadeRealUnscrap.success, true);
    const facadeRealWs = makeWorkspaceHandlers(facadeReal.globalResources, facadeReal.wm);
    await facadeRealWs.wsHandlers.handleWorkspaceGetFiles(
        {},
        { id: 'default', requestId: 'r-files-rface' },
        agentClient(),
        facadeRealWs.wsServer
    );
    assert.deepStrictEqual(facadeRealWs.sent[0].data.files, facadeFakeWs.sent[0].data.files);
    assert.ok(!facadeReal.wm.getWorkspace('default').files.includes('a.png'));
}

async function mutateGalleryAs(ws, client, method, filename, extra) {
    ws.sent.length = 0;
    ws.broadcasts.length = 0;
    await ws.wsHandlers[method](
        {},
        { id: 'default', filename, requestId: `r-${method}`, ...(extra || {}) },
        client,
        ws.wsServer
    );
}

function makeMetadataBackedTree(root, extras) {
    const tree = makeRealWorkspaceManager(root, extras);
    fs.writeFileSync(path.join(root, 'images', 'keep.png'), 'keep');
    const rec = tree.wm.getWorkspace('default');
    if (extras && extras.extraFiles) {
        for (const name of extras.extraFiles) {
            if (!rec.files.includes(name)) rec.files.push(name);
        }
    }
    tree.globalResources.saveConfig('workspaces', tree.globalResources.getWorkspacesConfig());
    return tree;
}

async function testAgentOwnedRemoteFileMatchesMain() {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-meta-db-'));
    assert.strictEqual(await metadataDatabase.initializeDatabase(dbDir), true);
    try {
        await insertImageRowForTest(dbDir, 'remote.png', { workspaceId: 'default' });
        await insertImageRowForTest(dbDir, 'gone.png', { workspaceId: 'default' });
        await metadataDatabase.removeImageMetadata(['gone.png']);
        const orphanSql = require('sqlite3');
        const { open } = require('sqlite');
        const conn = await open({
            filename: path.join(dbDir, 'metadata.db'),
            driver: orphanSql.Database
        });
        try {
            await conn.run('PRAGMA foreign_keys = OFF');
            await conn.run(
                `INSERT OR REPLACE INTO gallery_workspace_ownership
                 (filename, workspace_id, bucket, created_at) VALUES (?, ?, ?, strftime('%s', 'now'))`,
                ['gone.png', 'default', 'files']
            );
        } finally {
            await conn.close();
        }
        await metadataWriteQueue.drainAll();

        assert.ok(await metadataDatabase.getCachedMetadata('remote.png'));
        assert.strictEqual(await metadataDatabase.getCachedMetadata('gone.png'), null);
        const goneOwn = await metadataDatabase.getGalleryOwnershipForFilename('gone.png');
        assert.ok(goneOwn);

        const extras = { metadataDb: metadataDatabase, extraFiles: ['remote.png', 'gone.png'] };
        const agentScrap = makeMetadataBackedTree(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-remote-agent-')), extras);
        const ownerScrap = makeMetadataBackedTree(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-remote-owner-')), extras);
        assert.ok(!fs.existsSync(path.join(agentScrap.globalResources.getPath('images'), 'remote.png')));
        assert.strictEqual(await agentShouldNoopGalleryName(agentScrap.globalResources, 'remote.png'), false);
        assert.strictEqual(await agentShouldNoopGalleryName(agentScrap.globalResources, 'gone.png'), true);
        assert.strictEqual(await agentShouldNoopGalleryName(agentScrap.globalResources, 'a.png'), true);

        const agentScrapWs = makeWorkspaceHandlers(agentScrap.globalResources, agentScrap.wm);
        const ownerScrapWs = makeWorkspaceHandlers(ownerScrap.globalResources, ownerScrap.wm);
        await mutateGalleryAs(agentScrapWs, agentClient(), 'handleWorkspaceAddScrap', 'remote.png');
        await mutateGalleryAs(ownerScrapWs, userClient(), 'handleWorkspaceAddScrap', 'remote.png');
        assert.deepStrictEqual(agentScrapWs.sent[0].data, ownerScrapWs.sent[0].data);
        assert.deepStrictEqual(agentScrapWs.broadcasts[0].data, ownerScrapWs.broadcasts[0].data);
        assert.ok(agentScrap.wm.getWorkspace('default').scraps.includes('remote.png'));
        assert.ok(ownerScrap.wm.getWorkspace('default').scraps.includes('remote.png'));

        const goneFake = makeMetadataBackedTree(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-gone-fake-')), extras);
        goneFake.wm.markHiddenByFakeDelete(['gone.png'], 'default');
        goneFake.wm.addToWorkspaceArray('scraps', 'gone.png', 'default');
        const goneReal = makeMetadataBackedTree(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-gone-real-')), extras);
        dropNameFromFiles(goneReal.wm, 'gone.png');
        const goneFakeWs = makeWorkspaceHandlers(goneFake.globalResources, goneFake.wm);
        const goneRealWs = makeWorkspaceHandlers(goneReal.globalResources, goneReal.wm);
        await mutateGalleryAs(goneFakeWs, agentClient(), 'handleWorkspaceRemoveScrap', 'gone.png');
        await mutateGalleryAs(goneRealWs, agentClient(), 'handleWorkspaceRemoveScrap', 'gone.png');
        assert.ok(!goneFake.wm.getWorkspace('default').files.includes('gone.png'));
        assert.ok(!goneReal.wm.getWorkspace('default').files.includes('gone.png'));
        await mutateGalleryAs(goneRealWs, agentClient(), 'handleWorkspaceAddScrap', 'gone.png');
        assert.ok(!goneReal.wm.getWorkspace('default').scraps.includes('gone.png'));
        assert.ok(!goneReal.wm.getWorkspace('default').files.includes('gone.png'));

        const agentPin = makeMetadataBackedTree(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-remote-pin-a-')), extras);
        const ownerPin = makeMetadataBackedTree(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-remote-pin-o-')), extras);
        const agentPinWs = makeWorkspaceHandlers(agentPin.globalResources, agentPin.wm);
        const ownerPinWs = makeWorkspaceHandlers(ownerPin.globalResources, ownerPin.wm);
        await mutateGalleryAs(agentPinWs, agentClient(), 'handleWorkspaceAddPinned', 'remote.png');
        await mutateGalleryAs(ownerPinWs, userClient(), 'handleWorkspaceAddPinned', 'remote.png');
        assert.deepStrictEqual(agentPinWs.sent[0].data, ownerPinWs.sent[0].data);
        assert.ok(agentPin.wm.getWorkspace('default').pinned.includes('remote.png'));
        assert.ok(ownerPin.wm.getWorkspace('default').pinned.includes('remote.png'));

        const agentFav = makeMetadataBackedTree(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-remote-fav-a-')), extras);
        const ownerFav = makeMetadataBackedTree(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-remote-fav-o-')), extras);
        attachWorkspacePackets(agentFav.globalResources);
        const favAgent = parseToolText(await _test.callTool(
            agentFav.globalResources,
            facadeAgentReq(),
            'toggle_favorite',
            { filename: 'remote.png' }
        ));
        const ownerFavWs = makeWorkspaceHandlers(ownerFav.globalResources, ownerFav.wm);
        await mutateGalleryAs(ownerFavWs, userClient(), 'handleWorkspaceAddPinned', 'remote.png');
        assert.strictEqual(favAgent.success, true);
        assert.ok(agentFav.wm.getWorkspace('default').pinned.includes('remote.png'));
        assert.ok(ownerFav.wm.getWorkspace('default').pinned.includes('remote.png'));
    } finally {
        try { await metadataDatabase.closeDatabase(); } catch (_err) { /* test-only */ }
    }
}

async function run() {
    await testRealAndFakeMatchFrozenMain();
    await testOrdinaryScrapsStayVisible();
    await testRealWorkspaceManagerPersistsClear();
    await testAgentUnscrapLeavesHidden();
    await testDumpAndDeleteCarryHiddenMarks();
    await testRemoveFilesFromWorkspacesClearsHidden();
    await testOwnerVfsRestoreClearsMark();
    await testBulkUnscrapBroadcastParity();
    await testListingFiltersOmitHidden();
    await testFakeDeletedMatchesRealDeleteTells();
    await testAgentMissingAndHiddenMutationsNoop();
    await testAgentUnscrapThenGetFilesFakeVsReal();
    await testAgentOwnedRemoteFileMatchesMain();
    await testFacadeScrapImagesRemoveFakeDeleted();
    await testDeleteUnupscaledOriginalGated();
    await testMcpCannotFlipAllowDelete();
    await testExistingTokensDefaultOff();
    await testFacadePassesWorkspace();
    try {
        await getDb().close();
    } catch (_err) {
        // test-only shutdown
    }
    console.log('test-mcp-allow-delete: ok');
    process.exit(0);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
