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
    filenameHiddenByFakeDelete,
    collectPayloadFilenames,
    rejectAgentHiddenHttpFile
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
    handleDeleteUnupscaledOriginal
} = require('../modules/ws/handlers/120-galleryHandler');
const WorkspaceManager = require('../modules/workspace');
const { WorkspaceWebSocketHandlers } = require('../modules/ws/handlers/90-workspaceHandler');
const { filterFilenamesVisibleToClient } = require('../modules/imageModerationFlag');
const { _test } = require('../modules/mcpAgentFacade');

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
            removeFromWorkspaceArray(type, filename, id, _override, options) {
                const rec = workspaces[id] || workspaces.default;
                if (!rec) throw new Error(`Workspace ${id} not found`);
                const names = Array.isArray(filename) ? filename : [filename];
                if (type === 'scraps' && Array.isArray(rec.scraps)) {
                    rec.scraps = rec.scraps.filter((name) => !names.includes(name));
                }
                if (options && options.clearHiddenByFakeDelete) {
                    this.clearHiddenByFakeDelete(names);
                }
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
        applicationAuth: { applicationKeyId: 'key-1', allowDelete: false }
    };
}

function userClient() {
    return { userType: 'admin', authMethod: 'session' };
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

    workspaceState.api.removeFromWorkspaceArray('scraps', 'a.png', 'lab', null, { clearHiddenByFakeDelete: true });
    assert.strictEqual(filenameHiddenByFakeDelete(harness.globalResources, 'a.png'), false);
    assert.strictEqual(await agentCannotSeeFilename(harness.globalResources, 'a.png'), false);
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

function makeRealWorkspaceManager(root) {
    fs.mkdirSync(path.join(root, 'images'), { recursive: true });
    const workspacesPath = path.join(root, 'workspaces.json');
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
            groups: {}
        }
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
            return opts && opts.clone ? JSON.parse(JSON.stringify(cache)) : cache;
        },
        setWorkspacesConfigCache(next) { cache = next; },
        saveConfig(type, data) {
            if (type === 'workspaces' && data) {
                cache = data;
                fs.writeFileSync(workspacesPath, JSON.stringify(data));
            }
        },
        getMetadataDatabase: () => null,
        metadataDatabase: null,
        getDataPlumbing: () => ({ publish() {} }),
        getReferenceMetadataDatabase: () => ({
            deleteMetadata() {},
            getWorkspaceReferenceCounts() { return {}; },
            moveAllReferencesBetweenWorkspaces() { return 0; },
            moveAllVibesBetweenWorkspaces() { return 0; }
        }),
        getNotesDatabase: () => null,
        getWebSocketServer: () => ({ broadcast() {} })
    };
    return {
        wm: new WorkspaceManager(globalResources),
        globalResources,
        workspacesPath,
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
    assert.strictEqual(broadcasts.length, 0);
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

async function run() {
    await testRealAndFakeMatchFrozenMain();
    await testOrdinaryScrapsStayVisible();
    await testRealWorkspaceManagerPersistsClear();
    await testAgentUnscrapLeavesHidden();
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
