const assert = require('assert');
const Module = require('module');

// Mock missing modules in sandbox environment
const originalRequire = Module.prototype.require;
let mockDb = null;

Module.prototype.require = function(request) {
    if (request === 'better-sqlite3') {
        return function MockDatabase(path) {
            return mockDb;
        };
    }
    if (request === 'winston') {
        return {
            format: {
                combine: () => {},
                timestamp: () => {},
                printf: () => {},
                colorize: () => {},
                errors: () => {}
            },
            createLogger: () => ({
                info: () => {},
                error: () => {},
                warn: () => {},
                debug: () => {},
                add: () => {}
            }),
            transports: {
                Console: function() {},
                File: function() {}
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

const ReferenceMetadataDatabase = require('../modules/referenceMetadataDatabase');

async function runTests() {
    console.log('Testing ReferenceMetadataDatabase batch methods with spread parameters...');

    const calls = [];

    mockDb = {
        pragma: () => {},
        exec: () => {},
        prepare: (sql) => {
            return {
                all: (...args) => {
                    calls.push({ sql, args });
                    return [];
                }
            };
        }
    };

    const mockGlobalResources = {
        getPath: () => '/tmp'
    };

    const refDb = new ReferenceMetadataDatabase(mockGlobalResources);

    // 1. getMetadataForReferences
    calls.length = 0;
    refDb.getMetadataForReferences(['hash1', 'hash2']);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args, ['hash1', 'hash2'], 'getMetadataForReferences should spread hashes as separate arguments');

    // 2. getFileCacheForReferences
    calls.length = 0;
    refDb.getFileCacheForReferences(['hash1', 'hash2']);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args, ['hash1', 'hash2'], 'getFileCacheForReferences should spread hashes as separate arguments');

    // 3. getReferenceWorkspacesBatch
    calls.length = 0;
    refDb.getReferenceWorkspacesBatch(['hash1', 'hash2']);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args, ['hash1', 'hash2'], 'getReferenceWorkspacesBatch should spread hashes as separate arguments');

    // 4. getVibeMetadataForVibes
    calls.length = 0;
    refDb.getVibeMetadataForVibes(['vibe1', 'vibe2']);
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[0].args, ['vibe1', 'vibe2'], 'getVibeMetadataForVibes 1st query should spread vibeIds');
    assert.deepStrictEqual(calls[1].args, ['vibe1', 'vibe2'], 'getVibeMetadataForVibes 2nd query should spread vibeIds');

    // 5. _formatVibeResults (uses vibeIds IN placeholder spread)
    calls.length = 0;
    refDb._formatVibeResults([{ id: 'vibe1' }, { id: 'vibe2' }]);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args, ['vibe1', 'vibe2'], '_formatVibeResults query should spread vibeIds');

    // 6. getVibeWorkspacesBatch
    calls.length = 0;
    refDb.getVibeWorkspacesBatch(['vibe1', 'vibe2']);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args, ['vibe1', 'vibe2'], 'getVibeWorkspacesBatch should spread vibeIds');

    console.log('ALL BATCH SPREAD TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
