const assert = require('assert');
const {
    clientMatchesGalleryWorkspace,
    galleryUpdatedAtMs
} = require('../modules/ws/handlers/120-galleryHandler');

const handlers = {
    globalResources: {
        getWorkspaceManager: () => ({
            getActiveWorkspace: (sid) => {
                if (!sid) throw new Error('Session ID is required');
                return sid === 's1' ? 'folder-a' : 'default';
            }
        })
    }
};

assert.strictEqual(clientMatchesGalleryWorkspace(handlers, { sessionId: 's1' }, 'folder-a'), true);
assert.strictEqual(clientMatchesGalleryWorkspace(handlers, { sessionId: 's1' }, 'default'), false);
assert.strictEqual(clientMatchesGalleryWorkspace(handlers, { sessionId: 's2' }, 'default'), true);
assert.strictEqual(clientMatchesGalleryWorkspace(handlers, { sessionId: null }, 'default'), false);
assert.strictEqual(clientMatchesGalleryWorkspace(handlers, {}, 'folder-a'), false);

assert.strictEqual(galleryUpdatedAtMs(0), 0);
assert.strictEqual(galleryUpdatedAtMs(null), 0);
assert.strictEqual(galleryUpdatedAtMs(1710000000), 1710000000 * 1000);
assert.strictEqual(galleryUpdatedAtMs(1710000000000), 1710000000000);

console.log('test-gallery-workspace-broadcast: ok');
