#!/usr/bin/env node
/**
 * #508: an empty gallery database is a successful request_gallery page
 * (paginated and block-fetch). A thrown query is still an error.
 * Run: node scripts/test-gallery-empty-page.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const metadataDb = require('../modules/metadataDatabase');
const galleryHandler = require('../modules/ws/handlers/120-galleryHandler');
const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');

function assertEmptyPage(sent, errors, label, offset, limit) {
    assert.strictEqual(errors.length, 0, `${label} must not error: ${JSON.stringify(errors)}`);
    assert.strictEqual(sent.length, 1, `${label} must send one response`);
    const msg = sent[0];
    assert.strictEqual(msg.type, 'request_gallery_response', label);
    assert.ok(Array.isArray(msg.data.gallery), label);
    assert.strictEqual(msg.data.gallery.length, 0, label);
    assert.strictEqual(msg.data.pagination.totalItems, 0, label);
    assert.strictEqual(msg.data.pagination.hasMore, false, label);
    assert.strictEqual(msg.data.pagination.offset, offset, label);
    assert.strictEqual(msg.data.pagination.limit, limit, label);
    assert.strictEqual(msg.data.viewType, 'images', label);
    assert.strictEqual(msg.data.workspaceId, 'default', label);
    assert.strictEqual(msg.data.latestFilename, null, label);
    assert.ok(Array.isArray(msg.data.pinnedIndexes), label);
    assert.strictEqual(msg.data.pinnedIndexes.length, 0, label);
    assert.strictEqual(msg.data.blockSize, 750, label);
    assert.strictEqual(msg.data.blockOffset, offset, label);
    assert.strictEqual(msg.data.lastGalleryDestructiveAt, 0, label);
    assert.strictEqual(msg.data.lastGalleryUpdatedAt, 0, label);
    assert.strictEqual(msg.data.replicationContext, null, label);
}

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-empty-508-'));
    const sent = [];
    const errors = [];
    const handlers = {
        startKeepAliveInterval() {},
        stopKeepAliveInterval() {},
        sendToClient(_ws, message) {
            sent.push(message);
        },
        sendError(_ws, message, details, requestId) {
            errors.push({ message, details, requestId });
        },
        globalResources: {
            getWorkspaceManager() {
                return {
                    getActiveWorkspace() {
                        return 'default';
                    },
                    setActiveWorkspace() {},
                    getWorkspace() {
                        return { lastGalleryDestructiveAt: 0 };
                    }
                };
            },
            getWorkspacesConfig() {
                return { default: { name: 'default' } };
            },
            getMetadataDatabase() {
                return metadataDb;
            },
            getReplicationService() {
                return {
                    getReplicationConfig() {
                        return { role: 'standalone' };
                    },
                    getAssetRegistry() {
                        return null;
                    }
                };
            }
        }
    };

    try {
        const opened = await metadataDb.initializeDatabase(dir);
        assert.strictEqual(opened, true, 'empty metadata db should initialize');

        const count = await metadataDb.countGalleryWorkspaceItems('default', 'images');
        assert.strictEqual(count, 0, 'fixture db must have no gallery rows');

        galleryHandler.registerPackets(handlers);
        const handle = wsPacketRegistry.getWsPacketHandler('request_gallery');
        assert.ok(handle, 'request_gallery handler should be registered');

        async function request(message) {
            sent.length = 0;
            errors.length = 0;
            await handle({
                handlers,
                ws: {},
                message,
                clientInfo: { sessionId: 'sess-empty' },
                wsServer: {}
            });
        }

        await request({
            type: 'request_gallery',
            requestId: 'page-1',
            viewType: 'images',
            offset: 0,
            limit: 1,
            light: true,
            includePinnedStatus: true
        });
        assertEmptyPage(sent, errors, 'paginated limit 1', 0, 1);
        assert.strictEqual(sent[0].requestId, 'page-1');

        await request({
            type: 'request_gallery',
            requestId: 'page-100',
            viewType: 'images',
            offset: 0,
            limit: 100,
            light: true
        });
        assertEmptyPage(sent, errors, 'paginated limit 100', 0, 100);
        assert.strictEqual(sent[0].requestId, 'page-100');

        await request({
            type: 'request_gallery',
            requestId: 'block-750',
            viewType: 'images',
            offset: 0,
            limit: 750,
            light: true,
            galleryBlockFetch: true,
            includePinnedStatus: false
        });
        assertEmptyPage(sent, errors, 'block fetch', 0, 750);
        assert.strictEqual(sent[0].requestId, 'block-750');

        const originalList = metadataDb.listWorkspaceGalleryItemsPaginated;
        metadataDb.listWorkspaceGalleryItemsPaginated = async function failGalleryPage() {
            throw new Error('SQLITE_IOERR');
        };
        try {
            await request({
                type: 'request_gallery',
                requestId: 'fail-page',
                viewType: 'images',
                offset: 0,
                limit: 100,
                light: true
            });
            assert.strictEqual(sent.length, 0, 'db failure must not send a gallery page');
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].message, 'Failed to load gallery');
            assert.strictEqual(errors[0].details, 'SQLITE_IOERR');
            assert.strictEqual(errors[0].requestId, 'fail-page');

            await request({
                type: 'request_gallery',
                requestId: 'fail-block',
                viewType: 'images',
                offset: 0,
                limit: 750,
                light: true,
                galleryBlockFetch: true
            });
            assert.strictEqual(sent.length, 0, 'block db failure must not send a gallery page');
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].message, 'Failed to load gallery');
            assert.strictEqual(errors[0].details, 'SQLITE_IOERR');
            assert.notStrictEqual(errors[0].details, 'Fast gallery block path failed');
        } finally {
            metadataDb.listWorkspaceGalleryItemsPaginated = originalList;
        }

        console.log('test-gallery-empty-page: ok');
    } finally {
        try {
            await metadataDb.closeDatabase();
        } catch (closeError) {
            console.error(closeError);
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().then(() => {
    process.exit(0);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
