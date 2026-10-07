const assert = require('assert');
const { resolveDynagenWithWren } = require('../modules/dynagenWren');

async function run() {
    console.log("Testing omitted dynamicGeneration does not compile...");
    let compileAttempted = false;

    // Mock globalResources enough to trace if compileContext gets called
    const gr = {
        getPath: () => '',
        getSecureConfig: () => { compileAttempted = true; return {}; }
    };

    // Empty dynamic_generation (enabled omitted)
    const bodyOmitted = { dynamic_generation: {} };

    try {
        await resolveDynagenWithWren(gr, bodyOmitted, null, null, null, null);
    } catch (e) {
        if (e.message.includes('compileContext') || e.message.includes('getSecureConfig')) {
            compileAttempted = true;
        }
    }

    assert.strictEqual(compileAttempted, false, "Should not attempt to compile context if enabled is omitted");

    // enabled: false
    const bodyFalse = { dynamic_generation: { enabled: false } };
    try {
        await resolveDynagenWithWren(gr, bodyFalse, null, null, null, null);
    } catch (e) {
        if (e.message.includes('compileContext') || e.message.includes('getSecureConfig')) {
            compileAttempted = true;
        }
    }

    assert.strictEqual(compileAttempted, false, "Should not attempt to compile context if enabled is false");

    console.log("Test passed!");
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
