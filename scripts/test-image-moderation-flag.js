const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    UNDER_REVIEW_ERROR,
    isMcpAgentClient,
    decorateGalleryRowsForClient,
    mcpUnderReviewPayload,
    rejectMcpFlagMutation,
    formatFlagRecord,
    emptyFlagRecord
} = require('../modules/imageModerationFlag');
const metadataDb = require('../modules/metadataDatabase');
const {
    applyModerationFlagsToGallery,
    handleClearImageFlag,
    handleConfirmImageFlag
} = require('../modules/ws/handlers/120-galleryHandler');
const { _test } = require('../modules/mcpAgentFacade');
const { scopesAllowPacket, getPacketScopes } = require('../modules/applicationAuthManager');

assert.strictEqual(isMcpAgentClient({ authMethod: 'application_key' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'oauth_access_token' }), true);
assert.strictEqual(isMcpAgentClient({ applicationAuth: { applicationKeyId: 'x' } }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'session' }), false);
assert.strictEqual(isMcpAgentClient({}), false);

const rows = [
    { filename: 'keep.png', original: 'keep.png' },
    { filename: 'flagged.png', original: 'flagged.png' }
];
const flags = {
    'keep.png': emptyFlagRecord(),
    'flagged.png': formatFlagRecord({
        flagged: 1,
        flagged_by: 'guren',
        flag_reason: 'check this',
        flagged_at: 1710000000000
    })
};
const hidden = decorateGalleryRowsForClient(rows, flags, { hideFlagged: true });
assert.strictEqual(hidden.length, 1);
assert.strictEqual(hidden[0].filename, 'keep.png');
const visible = decorateGalleryRowsForClient(rows, flags, { hideFlagged: false });
assert.strictEqual(visible.length, 2);
assert.strictEqual(visible[1].flagged, true);
assert.strictEqual(visible[1].flaggedBy, 'guren');
assert.strictEqual(visible[1].flagReason, 'check this');

const under = mcpUnderReviewPayload({ filename: null });
assert.strictEqual(under.success, false);
assert.strictEqual(under.underReview, true);
assert.strictEqual(under.error, UNDER_REVIEW_ERROR);

const mutation = rejectMcpFlagMutation();
assert.strictEqual(mutation.status, 403);
assert.strictEqual(mutation.code, 'USER_ONLY');

assert.deepStrictEqual(getPacketScopes('clear_image_flag'), []);
assert.deepStrictEqual(getPacketScopes('confirm_image_flag'), []);
assert.strictEqual(scopesAllowPacket(['gallery', 'generation', 'universal'].filter((s) => s !== 'universal'), 'clear_image_flag'), false);
assert.strictEqual(scopesAllowPacket(['gallery'], 'confirm_image_flag'), false);

assert.ok(_test.TOOL_DEFS.some((t) => t.name === 'flag_image' && t.core === true));
assert.ok(_test.toolAllowedForScopes(['notes'], { name: 'flag_image' }));
assert.ok(_test.toolAllowedForScopes(['generation'], { name: 'flag_image' }));
assert.ok(_test.toolAllowedForScopes([], { name: 'flag_image' }));
assert.strictEqual(_test.rateGroupForTool('flag_image'), 'write');
assert.ok(_test.TOOL_DEFS.find((t) => t.name === 'delete_images'));
assert.ok(!_test.TOOL_DEFS.some((t) => t.name === 'unflag_image' || t.name === 'clear_image_flag'));

function parseToolText(result) {
    const text = result && result.content && result.content[0] && result.content[0].text;
    return text ? JSON.parse(text) : {};
}

async function testFlagViaMcpTool() {
    const store = new Map();
    const globalResources = {
        getMetadataDatabase: () => ({
            async flagImage(filename, options) {
                const record = formatFlagRecord({
                    flagged: 1,
                    flagged_by: options.flaggedBy,
                    flag_reason: options.reason,
                    flagged_at: Date.now()
                });
                store.set(filename, record);
                return record;
            },
            async isImageOrPairFlagged(filename) {
                return !!(store.get(filename) && store.get(filename).flagged);
            },
            async isImageFlagged(filename) {
                return !!(store.get(filename) && store.get(filename).flagged);
            },
            async getImageModerationFlags(names) {
                const out = {};
                for (const name of names || []) out[name] = store.get(name) || emptyFlagRecord();
                return out;
            },
            async flaggedFilenameSet(names) {
                const set = new Set();
                for (const name of names || []) {
                    if (store.get(name) && store.get(name).flagged) set.add(name);
                }
                return set;
            },
            async getLatestUnflaggedGalleryFilename() {
                return 'keep.png';
            }
        }),
        getWebSocketServer: () => ({ broadcast() {} }),
        getPath: () => os.tmpdir()
    };
    const req = {
        authMethod: 'application_key',
        applicationAuth: { applicationScopes: ['notes'], appName: 'guren' }
    };
    const flagged = await _test.callTool(globalResources, req, 'flag_image', {
        filename: 'flagged.png',
        reason: 'moderation review'
    });
    const body = parseToolText(flagged);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.flagged, true);
    assert.strictEqual(body.flaggedBy, 'guren');
    assert.strictEqual(body.reason, 'moderation review');

    assert.strictEqual(await _test.mcpFilenameIsFlagged(globalResources, 'flagged.png'), true);
    assert.strictEqual(await _test.mcpFilenameIsFlagged(globalResources, 'keep.png'), false);

    const hiddenRows = await _test.filterMcpGalleryRows(globalResources, [
        { filename: 'keep.png' },
        { filename: 'flagged.png' }
    ]);
    assert.strictEqual(hiddenRows.length, 1);
    assert.strictEqual(hiddenRows[0].filename, 'keep.png');

    const review = parseToolText(_test.mcpUnderReviewResult({ filename: null }));
    assert.strictEqual(review.underReview, true);
    assert.strictEqual(review.error, UNDER_REVIEW_ERROR);

    const userRows = await applyModerationFlagsToGallery(
        globalResources.getMetadataDatabase(),
        [{ filename: 'keep.png' }, { filename: 'flagged.png' }],
        { authMethod: 'session' }
    );
    assert.strictEqual(userRows.length, 2);
    assert.strictEqual(userRows[1].flagged, true);

    const mcpRows = await applyModerationFlagsToGallery(
        globalResources.getMetadataDatabase(),
        [{ filename: 'keep.png' }, { filename: 'flagged.png' }],
        { authMethod: 'application_key' }
    );
    assert.strictEqual(mcpRows.length, 1);
}

async function testUserOnlyClearConfirm() {
    let lastError = null;
    const handlers = {
        sendError(ws, message, details, requestId) {
            lastError = { message, details, requestId };
        },
        sendToClient() {
            throw new Error('MCP must not reach success path');
        },
        globalResources: {
            getMetadataDatabase: () => ({
                clearImageFlag: async () => { throw new Error('should not clear'); },
                confirmImageFlag: async () => { throw new Error('should not confirm'); }
            })
        }
    };
    const mcpClient = { authMethod: 'application_key', applicationAuth: { applicationScopes: ['universal'] } };
    await handleClearImageFlag(handlers, {}, { filename: 'flagged.png', requestId: 'r1' }, mcpClient, null);
    assert.ok(lastError);
    assert.ok(String(lastError.message).includes('Studio gallery') || lastError.details === 'USER_ONLY');
    lastError = null;
    await handleConfirmImageFlag(handlers, {}, { filename: 'flagged.png', requestId: 'r2' }, mcpClient, null);
    assert.ok(lastError);
    assert.ok(String(lastError.message).includes('Studio gallery') || lastError.details === 'USER_ONLY');

    const oauthClient = { authMethod: 'oauth_access_token' };
    lastError = null;
    await handleClearImageFlag(handlers, {}, { filename: 'flagged.png', requestId: 'r3' }, oauthClient, null);
    assert.ok(lastError);
}

async function testPersistAcrossReload() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderation-flag-'));
    try {
        const ok = await metadataDb.initializeDatabase(dir);
        assert.strictEqual(ok, true);
        const flagged = await metadataDb.flagImage('flagged.png', {
            flaggedBy: 'guren',
            reason: 'persist me'
        });
        assert.strictEqual(flagged.flagged, true);
        assert.strictEqual(flagged.flaggedBy, 'guren');
        await metadataDb.closeDatabase();

        const ok2 = await metadataDb.initializeDatabase(dir);
        assert.strictEqual(ok2, true);
        const reloaded = await metadataDb.getImageModerationFlag('flagged.png');
        assert.strictEqual(reloaded.flagged, true);
        assert.strictEqual(reloaded.flaggedBy, 'guren');
        assert.strictEqual(reloaded.reason, 'persist me');

        const cleared = await metadataDb.clearImageFlag('flagged.png');
        assert.strictEqual(cleared.flagged, false);
        await metadataDb.flagImage('flagged.png', { flaggedBy: 'user', reason: 'again' });
        const confirmed = await metadataDb.confirmImageFlag('flagged.png');
        assert.strictEqual(confirmed.confirmed, true);
        await metadataDb.closeDatabase();
    } finally {
        try { await metadataDb.closeDatabase(); } catch (_err) { /* ignore */ }
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

async function run() {
    await testFlagViaMcpTool();
    await testUserOnlyClearConfirm();
    await testPersistAcrossReload();
    console.log('test-image-moderation-flag: ok');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
