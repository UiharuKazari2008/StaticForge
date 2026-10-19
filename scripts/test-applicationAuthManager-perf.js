const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') return {
        createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, add: () => {} }),
        transports: { Console: class {}, DailyRotateFile: class {}, File: class {} },
        format: {
            combine: () => {},
            timestamp: () => {},
            printf: () => {},
            colorize: () => {},
            errors: () => {},
            splat: () => {}
        }
    };
    if (request === 'winston-daily-rotate-file') return class {};
    if (request === 'sqlite3') return {};
    if (request === 'sqlite') return {};
    if (request === 'better-sqlite3') return function() { return { pragma: () => {}, prepare: () => ({ run: () => {} }), exec: () => {} }; };
    try {
        return originalLoad(request, parent, isMain);
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
             return {};
        }
        throw e;
    }
};

const fs = require('fs');
const assert = require('assert');
const {
    normalizeScopes,
    scopesForReplace,
    AVAILABLE_SCOPES
} = require('../modules/applicationAuthManager.js');

// Create large inputs to measure performance
const SAMPLES = [];
for (let i = 0; i < 1000; i++) {
    SAMPLES.push(AVAILABLE_SCOPES.map(s => s.id));
    SAMPLES.push(['search', 'workspace', 'wiki', 'universal', 'generation']);
    SAMPLES.push([]);
    SAMPLES.push(['invalid_scope_1', 'invalid_scope_2', 'invalid_scope_3']);
}

const baselineFile = 'scripts/baseline-applicationAuthManager.json';

function runTests() {
    const results = {
        normalizeScopes: [],
    };

    for (const sample of SAMPLES) {
        results.normalizeScopes.push(normalizeScopes(sample));
    }
    return results;
}

if (process.argv.includes('--baseline')) {
    const start = performance.now();
    const results = runTests();
    const duration = performance.now() - start;
    fs.writeFileSync(baselineFile, JSON.stringify(results, null, 2));
    console.log(`Baseline saved to ${baselineFile} (took ${duration.toFixed(2)}ms)`);
} else if (process.argv.includes('--verify')) {
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    const start = performance.now();
    const current = runTests();
    const duration = performance.now() - start;
    assert.deepStrictEqual(current, baseline, 'Outputs differ from baseline!');
    console.log(`Verification passed: Output is identical to baseline. (took ${duration.toFixed(2)}ms)`);
} else {
    console.error('Pass --baseline or --verify');
    process.exit(1);
}
