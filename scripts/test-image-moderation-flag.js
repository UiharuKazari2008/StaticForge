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
    UNDER_REVIEW_ERROR,
    isMcpAgentClient,
    decorateGalleryRowsForClient,
    mcpUnderReviewPayload,
    rejectMcpFlagMutation,
    formatFlagRecord,
    emptyFlagRecord,
    collectPayloadFilenames,
    filenameHiddenByFakeDelete,
    collectFakeDeletedFilenames
} = require('../modules/imageModerationFlag');
const { scopesAllowPacket, getPacketScopes } = require('../modules/applicationAuthManager');
const { _test } = require('../modules/mcpAgentFacade');

assert.strictEqual(isMcpAgentClient({ authMethod: 'application_key' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'oauth_access_token' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'temp_token' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'dev_login_key' }), true);
assert.strictEqual(isMcpAgentClient({ authMethod: 'dev_admin_session' }), true);
assert.strictEqual(isMcpAgentClient({ userType: 'dev_admin' }), true);
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
assert.strictEqual(scopesAllowPacket(['gallery'], 'clear_image_flag'), false);
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
    } finally {
        await conn.close();
    }
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

    const userRows = decorateGalleryRowsForClient(
        [{ filename: 'keep.png' }, { filename: 'flagged.png' }],
        await globalResources.getMetadataDatabase().getImageModerationFlags(['keep.png', 'flagged.png']),
        { hideFlagged: false }
    );
    assert.strictEqual(userRows.length, 2);
    assert.strictEqual(userRows[1].flagged, true);

    const mcpRows = decorateGalleryRowsForClient(
        [{ filename: 'keep.png' }, { filename: 'flagged.png' }],
        await globalResources.getMetadataDatabase().getImageModerationFlags(['keep.png', 'flagged.png']),
        { hideFlagged: true }
    );
    assert.strictEqual(mcpRows.length, 1);

    const again = parseToolText(await _test.callTool(globalResources, req, 'flag_image', {
        filename: 'flagged.png',
        reason: 'must not echo existing flagger'
    }));
    assert.strictEqual(again.success, false);
    assert.strictEqual(again.underReview, true);
    assert.strictEqual(again.flaggedBy, undefined);
    assert.strictEqual(again.reason, undefined);

    const fakeDeleted = {
        ...globalResources,
        getWorkspaceManager: () => ({
            listHiddenByFakeDelete() { return ['ghost.png']; },
            getWorkspaces() { return { default: { hiddenByFakeDelete: ['ghost.png'], scraps: ['owner-scrap.png'] } }; }
        })
    };
    const hiddenFlag = parseToolText(await _test.callTool(fakeDeleted, req, 'flag_image', {
        filename: 'ghost.png',
        reason: 'already fake-deleted'
    }));
    assert.strictEqual(hiddenFlag.success, false);
    assert.strictEqual(hiddenFlag.underReview, true);
    assert.strictEqual(hiddenFlag.flaggedBy, undefined);
    assert.strictEqual(await _test.mcpFilenameIsFlagged(fakeDeleted, 'ghost.png'), true);
    assert.strictEqual(await _test.mcpFilenameIsFlagged(fakeDeleted, 'owner-scrap.png'), false);
    assert.strictEqual(filenameHiddenByFakeDelete(fakeDeleted, 'ghost.png'), true);
    assert.strictEqual(filenameHiddenByFakeDelete(fakeDeleted, 'owner-scrap.png'), false);
    assert.ok(collectFakeDeletedFilenames(fakeDeleted).has('ghost.png'));
    assert.ok(!collectFakeDeletedFilenames(fakeDeleted).has('owner-scrap.png'));

    const names = [];
    collectPayloadFilenames({
        shortcuts: [
            { name: 'flagged.png', type: 'image', data: { filename: 'flagged.png' } },
            { name: 'keep.png', type: 'image' }
        ]
    }, names);
    assert.ok(names.includes('flagged.png'));
    assert.ok(names.includes('keep.png'));
    const redacted = await _test.redactMcpFilenameFields(globalResources, {
        shortcuts: [
            { name: 'flagged.png', type: 'image', data: { filename: 'flagged.png' } },
            { name: 'keep.png', type: 'image', data: { filename: 'keep.png' } }
        ]
    });
    assert.strictEqual(redacted.shortcuts.length, 1);
    assert.strictEqual(redacted.shortcuts[0].name, 'keep.png');
}

async function testUserOnlyClearConfirm() {
    for (const client of [
        { authMethod: 'application_key', applicationAuth: { applicationScopes: ['universal'] } },
        { authMethod: 'oauth_access_token' }
    ]) {
        assert.strictEqual(isMcpAgentClient(client), true);
        const err = rejectMcpFlagMutation();
        assert.strictEqual(err.code, 'USER_ONLY');
        assert.strictEqual(err.status, 403);
    }
}

async function testPersistAcrossReload() {
    let metadataDb;
    try {
        metadataDb = require('../modules/metadataDatabase');
    } catch (error) {
        assert.fail('metadataDatabase failed to load for persist test: ' + error.message);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderation-flag-'));
    try {
        const ok = await metadataDb.initializeDatabase(dir);
        assert.strictEqual(ok, true);
        await insertImageRowForTest(dir, 'flagged.png');
        await insertImageRowForTest(dir, 'keep.png');
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

        const overwritten = await metadataDb.flagImage('flagged.png', {
            flaggedBy: 'intruder',
            reason: 'rewrite the review'
        });
        assert.strictEqual(overwritten.flaggedBy, 'user');
        assert.strictEqual(overwritten.reason, 'again');
        assert.strictEqual(overwritten.confirmed, true);

        try {
            await metadataDb.flagImage('missing.png', { flaggedBy: 'guren', reason: 'no row' });
            assert.fail('flagImage must reject filenames that are not in the gallery');
        } catch (error) {
            assert.strictEqual(error.status, 404);
            assert.strictEqual(error.message, 'File not found');
        }

        await metadataDb.removeImageMetadata(['flagged.png']);
        const afterDelete = await metadataDb.getImageModerationFlag('flagged.png');
        assert.strictEqual(afterDelete.flagged, false);
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
    process.exit(0);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
