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
    shapeMcpDeleteSuccess,
    aliasMcpDeleteToScrap,
    rejectMcpTokenConfigMutation,
    isMcpAgentClient
} = require('../modules/imageModerationFlag');
const {
    getPacketScopes,
    scopesAllowPacket,
    ADMIN_MANAGEMENT_WS_PACKETS,
    ApplicationAuthManager
} = require('../modules/applicationAuthManager');
const { initializeApplicationAuthDatabase, getDb } = require('../modules/applicationAuthDatabase');
const { handleUpdateApplicationKeyFlags } = require('../modules/ws/handlers/195-applicationAuthHandler');
const { registerWsPacket } = require('../modules/ws/wsPacketRegistry');
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

const shaped = shapeMcpDeleteSuccess(['keep.png']);
assert.strictEqual(shaped.success, true);
assert.strictEqual(shaped.message, 'Bulk delete completed');
assert.strictEqual(shaped.totalProcessed, 1);
assert.strictEqual(shaped.successful, 1);
assert.strictEqual(shaped.failed, 0);
assert.deepStrictEqual(shaped.results[0], { filename: 'keep.png', deletedFiles: ['keep.png'] });
assert.strictEqual(JSON.stringify(shaped).toLowerCase().includes('scrap'), false);

assert.ok(ADMIN_MANAGEMENT_WS_PACKETS.has('update_application_key_flags'));
assert.deepStrictEqual(getPacketScopes('update_application_key_flags'), []);
assert.strictEqual(scopesAllowPacket(['gallery'], 'update_application_key_flags'), false);
assert.strictEqual(scopesAllowPacket(['universal'], 'update_application_key_flags'), true);
assert.ok(!_test.TOOL_DEFS.some((t) => /allow_delete|update_application_key|unflag|clear_image_flag/i.test(t.name)));
assert.ok(_test.TOOL_DEFS.some((t) => t.name === 'delete_images'));

function makeResources(scraps) {
    return {
        getWorkspaceManager: () => ({
            addToWorkspaceArray(type, filename, id) {
                scraps.push({ type, filename, id });
            }
        }),
        getWebSocketServer: () => ({ broadcast() {} }),
        getWebSocketMessageHandlers: () => ({
            isDestructiveOperation() { return false; }
        }),
        getMetadataDatabase: () => ({
            async isImageOrPairFlagged() { return false; }
        }),
        getPath: () => os.tmpdir()
    };
}

async function testDeleteWithoutFlagGoesToScraps() {
    const scraps = [];
    const body = parseToolText(await _test.callTool(
        makeResources(scraps),
        {
            authMethod: 'application_key',
            applicationAuth: { applicationScopes: ['gallery', 'workspace'], appName: 'guren' }
        },
        'delete_images',
        { filename: 'keep.png', workspace: 'default' }
    ));
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.message, 'Bulk delete completed');
    assert.strictEqual(body.packetType, 'delete_images_bulk_response');
    assert.strictEqual(body.totalProcessed, 1);
    assert.strictEqual(body.successful, 1);
    assert.deepStrictEqual(body.results[0].filename, 'keep.png');
    assert.strictEqual(JSON.stringify(body).toLowerCase().includes('scrap'), false);
    assert.strictEqual(JSON.stringify(body).toLowerCase().includes('not allowed'), false);
    assert.strictEqual(scraps.length, 1);
    assert.strictEqual(scraps[0].type, 'scraps');
    assert.strictEqual(scraps[0].filename, 'keep.png');
}

async function testDeleteWithFlagIsRealDelete() {
    const scraps = [];
    const hard = [];
    registerWsPacket('delete_images_bulk', async (ctx) => {
        hard.push([].concat(ctx.message.filenames || []));
        ctx.wsServer.sendToClient(ctx.ws, {
            type: 'delete_images_bulk_response',
            data: {
                success: true,
                message: 'Bulk delete completed',
                results: (ctx.message.filenames || []).map((filename) => ({ filename, deletedFiles: [filename] })),
                errors: [],
                totalProcessed: (ctx.message.filenames || []).length,
                successful: (ctx.message.filenames || []).length,
                failed: 0
            }
        });
    });
    const body = parseToolText(await _test.callTool(
        makeResources(scraps),
        {
            authMethod: 'application_key',
            applicationAuth: {
                applicationScopes: ['gallery', 'workspace'],
                appName: 'guren',
                allowDelete: true
            }
        },
        'delete_images',
        { filename: 'gone.png' }
    ));
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.message, 'Bulk delete completed');
    assert.strictEqual(scraps.length, 0);
    assert.deepStrictEqual(hard[0], ['gone.png']);
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
        { userType: 'admin', authMethod: 'oauth_access_token' }
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

    try {
        await _test.callTool(makeResources([]), {
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
}

async function run() {
    const scraps = [];
    const aliased = aliasMcpDeleteToScrap(makeResources(scraps), ['keep.png'], 'default');
    assert.strictEqual(aliased.success, true);
    assert.strictEqual(aliased.type, 'delete_images_bulk_response');
    assert.strictEqual(scraps[0].type, 'scraps');
    await testDeleteWithoutFlagGoesToScraps();
    await testDeleteWithFlagIsRealDelete();
    await testMcpCannotFlipAllowDelete();
    await testExistingTokensDefaultOff();
    console.log('test-mcp-allow-delete: ok');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
