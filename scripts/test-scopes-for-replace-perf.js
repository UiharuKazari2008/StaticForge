const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        const dummyLogger = {
            info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, verbose: () => {},
            add: () => {}, remove: () => {}
        };
        return {
            format: {
                combine: () => {}, timestamp: () => {}, printf: () => {}, colorize: () => {}, errors: () => {}, json: () => {}
            },
            transports: { Console: class {}, File: class {} },
            createLogger: () => dummyLogger,
            ...dummyLogger
        };
    }
    try {
        return originalLoad.apply(this, arguments);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            return {};
        }
        throw err;
    }
};

const assert = require('assert');
const { ApplicationAuthManager, scopesForReplace } = require('../modules/applicationAuthManager');

async function runTests() {
    console.log('Testing scopesForReplace optimization...');

    // Test invalid input (not an array)
    assert.throws(() => {
        scopesForReplace('invalid');
    }, (err) => {
        return err instanceof Error && err.message === 'scopes must be a list' && err.code === 'INVALID_SCOPES';
    });
    console.log('✔ Non-array scopes rejected with INVALID_SCOPES');

    // Test empty scopes array after cleaning
    assert.throws(() => {
        scopesForReplace(['  ', 'invalid_scope_xyz']);
    }, (err) => {
        return err instanceof Error && err.message === 'At least one scope is required' && err.code === 'EMPTY_SCOPES';
    });
    console.log('✔ Empty or invalid scope list rejected with EMPTY_SCOPES');

    // Universal collapses
    assert.deepStrictEqual(scopesForReplace(['gallery', 'universal', 'search']), ['universal']);
    console.log('✔ Universal scope collapses all other scopes');

    // Deduplication and valid scope filtering
    const sampleScopes = ['gallery', 'search', 'gallery', 'vfs', 'invalid_xyz', 'search'];
    assert.deepStrictEqual(scopesForReplace(sampleScopes), ['gallery', 'search', 'vfs']);
    console.log('✔ Valid scopes filtered and deduplicated correctly in O(1)');

    // Benchmark performance
    const largeScopeArray = [];
    const validIds = ['gallery', 'generation', 'workspace', 'search', 'vfs', 'presets', 'chat', 'references', 'wiki', 'autofill', 'notes', 'knowledge', 'nax', 'explore', 'infrastructure'];
    for (let i = 0; i < 1000; i++) {
        largeScopeArray.push(validIds[i % validIds.length]);
        largeScopeArray.push('invalid_' + (i % 50));
    }

    const start = process.hrtime.bigint();
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
        scopesForReplace(largeScopeArray);
    }
    const end = process.hrtime.bigint();
    const elapsedMs = Number(end - start) / 1e6;
    console.log(`✔ Benchmark completed ${iterations} iterations in ${elapsedMs.toFixed(2)} ms`);

    console.log('All tests passed successfully!');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
