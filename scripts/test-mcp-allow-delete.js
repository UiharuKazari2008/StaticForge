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
    filenameHiddenInScraps
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

function seedDeleteTree(root) {
    const imagesDir = path.join(root, 'images');
    const previewsDir = path.join(root, 'previews');
    const cacheDir = path.join(root, 'cache', 'dynGenPreview');
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(previewsDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, 'a.png'), 'orig');
    fs.writeFileSync(path.join(imagesDir, 'a_upscaled.png'), 'up');
    fs.writeFileSync(path.join(previewsDir, 'a.webp'), 'w');
    fs.writeFileSync(path.join(previewsDir, 'a@2x.webp'), 'w2');
    fs.writeFileSync(path.join(previewsDir, 'a@lq.webp'), 'lq');
    fs.writeFileSync(path.join(previewsDir, 'a@blur.webp'), 'blur');
    fs.writeFileSync(path.join(previewsDir, 'a_preview.png'), 'legacy');
    return { imagesDir, previewsDir, cacheDir };
}

function makeDeleteHandlers(root, options) {
    const scraps = [];
    const sent = [];
    const broadcasts = [];
    const flagged = new Set(options && options.flagged ? options.flagged : []);
    const allowDelete = !!(options && options.allowDelete);
    const { imagesDir, previewsDir, cacheDir } = {
        imagesDir: path.join(root, 'images'),
        previewsDir: path.join(root, 'previews'),
        cacheDir: path.join(root, 'cache')
    };
    const globalResources = {
        getPath(kind) {
            if (kind === 'images') return imagesDir;
            if (kind === 'previews') return previewsDir;
            if (kind === 'cache') return cacheDir;
            return root;
        },
        getPngMetadata: () => ({ readMetadata() { return {}; } }),
        getWorkspaceManager: () => ({
            addToWorkspaceArray(type, filename, id) {
                scraps.push({ type, filename, id });
            },
            removeFilesFromWorkspaces() {},
            getWorkspaces() {
                const names = scraps.filter((row) => row.type === 'scraps').map((row) => row.filename);
                return { default: { scraps: names } };
            }
        }),
        getWebSocketServer: () => ({
            broadcast(msg) { broadcasts.push(msg); }
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
    return { handlers, scraps, sent, broadcasts, globalResources };
}

async function runBulkDelete(root, clientInfo, filenames, extra) {
    const harness = makeDeleteHandlers(root, extra);
    await handleDeleteImagesBulk(
        harness.handlers,
        {},
        { filenames, workspace: 'lab', requestId: 'r-del' },
        clientInfo,
        { broadcast(msg) { harness.broadcasts.push(msg); } }
    );
    return harness;
}

async function testRealAndFakeDeleteAreIdentical() {
    const user = { userType: 'admin', authMethod: 'session' };
    const agent = {
        authMethod: 'application_key',
        applicationKeyId: 'key-1',
        applicationAuth: { applicationKeyId: 'key-1', allowDelete: false }
    };

    const existingReal = fs.mkdtempSync(path.join(os.tmpdir(), 'del-real-'));
    const existingFake = fs.mkdtempSync(path.join(os.tmpdir(), 'del-fake-'));
    seedDeleteTree(existingReal);
    seedDeleteTree(existingFake);

    const realExisting = await runBulkDelete(existingReal, user, ['a.png']);
    const fakeExisting = await runBulkDelete(existingFake, agent, ['a.png']);
    const realData = realExisting.sent[0].data;
    const fakeData = fakeExisting.sent[0].data;
    assert.deepStrictEqual(fakeData, realData);
    assert.deepStrictEqual(fakeData.results[0].deletedFiles, ['original', 'upscaled', 'preview', 'preview', 'preview', 'preview', 'preview']);
    assert.strictEqual(JSON.stringify(fakeData).toLowerCase().includes('scrap'), false);
    assert.ok(fs.existsSync(path.join(existingFake, 'images', 'a.png')));
    assert.ok(!fs.existsSync(path.join(existingReal, 'images', 'a.png')));
    assert.strictEqual(fakeExisting.scraps.some((row) => row.filename === 'a.png' && row.id === 'lab'), true);
    assert.strictEqual(fakeExisting.scraps.some((row) => row.filename === 'a_upscaled.png'), true);
    assert.strictEqual(await agentCannotSeeFilename(fakeExisting.globalResources, 'a.png'), true);
    assert.strictEqual(filenameHiddenInScraps(fakeExisting.globalResources, 'a.png'), true);

    const missingReal = fs.mkdtempSync(path.join(os.tmpdir(), 'del-miss-real-'));
    const missingFake = fs.mkdtempSync(path.join(os.tmpdir(), 'del-miss-fake-'));
    seedDeleteTree(missingReal);
    seedDeleteTree(missingFake);
    const realMissing = await runBulkDelete(missingReal, user, ['nope.png']);
    const fakeMissing = await runBulkDelete(missingFake, agent, ['nope.png']);
    assert.deepStrictEqual(fakeMissing.sent[0].data, realMissing.sent[0].data);
    assert.deepStrictEqual(realMissing.sent[0].data.errors, [{ filename: 'nope.png', error: 'File not found' }]);
    assert.strictEqual(realMissing.sent[0].data.successful, 0);
    assert.strictEqual(fakeMissing.scraps.length, 0);

    const flaggedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'del-flag-'));
    seedDeleteTree(flaggedRoot);
    const flagged = await runBulkDelete(flaggedRoot, agent, ['a.png'], { flagged: ['a.png'] });
    assert.deepStrictEqual(flagged.sent[0].data.errors, [{ filename: 'a.png', error: 'File not found' }]);
    assert.strictEqual(flagged.sent[0].data.successful, 0);
    assert.strictEqual(flagged.scraps.length, 0);
    assert.ok(fs.existsSync(path.join(flaggedRoot, 'images', 'a.png')));
}

async function testDeleteUnupscaledOriginalGated() {
    const agent = {
        authMethod: 'application_key',
        applicationKeyId: 'key-1',
        applicationAuth: { applicationKeyId: 'key-1', allowDelete: false }
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'del-unup-'));
    seedDeleteTree(root);
    const harness = makeDeleteHandlers(root, {});
    await handleDeleteUnupscaledOriginal(
        harness.handlers,
        {},
        { filename: 'a.png', workspace: 'lab', requestId: 'r-unup' },
        agent,
        { broadcast(msg) { harness.broadcasts.push(msg); } }
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
    const scraps = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'del-facade-'));
    seedDeleteTree(root);
    const globalResources = makeDeleteHandlers(root, {}).globalResources;
    globalResources.getWorkspaceManager = () => ({
        addToWorkspaceArray(type, filename, id) {
            scraps.push({ type, filename, id });
        },
        removeFilesFromWorkspaces() {},
        getWorkspaces() {
            return { lab: { scraps: scraps.filter((row) => row.id === 'lab').map((row) => row.filename) } };
        }
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
    assert.ok(scraps.some((row) => row.filename === 'a.png' && row.id === 'lab'));
}

async function run() {
    await testRealAndFakeDeleteAreIdentical();
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
