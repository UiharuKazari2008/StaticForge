const assert = require('assert');

// Global mocks
global.window = {
    fetch: async () => ({
        ok: true,
        json: async () => ({ models: [{ id: 'model1', name: 'Model 1' }] })
    })
};

global.document = {
    getElementById: (id) => {
        if (id === 'manualUpscaleModel') {
            return {
                tagName: 'SELECT',
                options: [],
                appendChild: function(child) { this.options.push(child); }
            };
        }
        return null;
    },
    createElement: (tag) => {
        if (tag === 'option') {
            return { tagName: 'OPTION' };
        }
        return { tagName: tag.toUpperCase() };
    }
};

global.fetchLocalUpscaleModels = async () => {};
global.knownLocalUpscaleModels = () => [{ id: 'model1', name: 'Model 1' }];
global.showConfirmationDialog = async () => 'cancel';
global.registerKeyboardListener = () => {};
global.openModal = () => {};
global.assignModalZIndex = () => {};
global.cleanupCreditCostDialog = () => {};
global.closeModal = async () => {};

// Read and eval the script, but we have to isolate it
const fs = require('fs');
const path = require('path');
const js = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/creditCostDialog.js'), 'utf-8');

// The script declares lets at top level, wrap in IIFE
const evalScript = `
(() => {
    ${js}
    
    // Make the function available globally for testing
    global.refreshLocalUpscaleSelectsTest = refreshLocalUpscaleSelects;
})();
`;

eval(evalScript);

async function test() {
    try {
        await global.refreshLocalUpscaleSelectsTest();
        console.log("PASS: refreshLocalUpscaleSelects executed without throwing on missing elements");
    } catch (err) {
        console.error("FAIL: refreshLocalUpscaleSelects threw an error:", err);
        process.exit(1);
    }
}

test();
