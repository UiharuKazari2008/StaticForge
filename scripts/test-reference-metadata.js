const assert = require('assert');
const path = require('path');
const os = require('os');

const Module = require('module');
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
    if (request === 'better-sqlite3') {
        return function MockDB() {
            return {
                pragma: () => {},
                exec: () => {},
                prepare: (sql) => {
                    return {
                        all: (...args) => {
                            const numPlaceholders = (sql.match(/\?/g) || []).length;
                            if (numPlaceholders > 1 && args.length === 1 && Array.isArray(args[0])) {
                                throw new Error(`Bind parameter mismatch: expected ${numPlaceholders} arguments, got 1 (array of length ${args[0].length}). When dynamically building IN (?,?,?) clauses, you MUST use the spread operator stmt.all(...array) with better-sqlite3.`);
                            }
                            return [];
                        }
                    };
                }
            };
        }
    }
    if (request === 'winston') {
        return {
            format: {
                combine: () => {}, timestamp: () => {}, printf: () => {},
                colorize: () => {}, splat: () => {}, errors: () => {}, json: () => {}
            },
            transports: { Console: class {}, File: class {}, DailyRotateFile: class {} },
            createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} })
        };
    }
    if (request === 'winston-daily-rotate-file') return class {};
    return originalLoad.apply(this, arguments);
};

const ReferenceMetadataDatabase = require('../modules/referenceMetadataDatabase');

const mockGlobalResources = {
    getPath: () => '/tmp/mock',
    getResource: () => '/tmp/mock'
};

const db = new ReferenceMetadataDatabase(mockGlobalResources);
db.db = new (Module._load('better-sqlite3'))();

let allPassed = true;

const tests = [
    { name: 'getMetadataForReferences', fn: () => db.getMetadataForReferences(['a', 'b', 'c']) },
    { name: 'getFileCacheForReferences', fn: () => db.getFileCacheForReferences(['a', 'b', 'c']) },
    { name: 'getReferenceWorkspacesBatch', fn: () => db.getReferenceWorkspacesBatch(['a', 'b', 'c']) },
    { name: 'getVibeWorkspacesBatch', fn: () => db.getVibeWorkspacesBatch(['v1', 'v2', 'v3']) },
    { name: 'getVibeMetadataForVibes', fn: () => db.getVibeMetadataForVibes(['v1', 'v2']) },
    { name: '_formatVibeResults', fn: () => db._formatVibeResults([{id: 'v1'}, {id: 'v2'}]) },
    { name: 'getWorkspaceVibesWithData', fn: () => db.getWorkspaceVibesWithData(['w1', 'w2']) }
];

for (const test of tests) {
    console.log(`\n--- Testing ${test.name} ---`);
    try {
        test.fn();
        console.log(`PASS: ${test.name}`);
    } catch (e) {
        console.error(`FAIL: ${test.name}:`, e.message);
        allPassed = false;
    }
}

if (!allPassed) {
    console.error("\nSome tests failed.");
    process.exit(1);
} else {
    console.log("\nAll tests passed successfully.");
    process.exit(0);
}
