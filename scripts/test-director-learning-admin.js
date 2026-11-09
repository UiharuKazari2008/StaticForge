const assert = require('assert');
const fs = require('fs');

// We simulate the browser environment for the script without jsdom
const documentMock = {
    getElementById: (id) => {
        if (id === 'directorFeedbackModal') {
            return { classList: { contains: () => false } };
        }
        return null;
    },
    createElement: () => ({ appendChild: () => {} }),
    body: { appendChild: () => {} }
};

const windowMock = {
    wsClient: null
};

global.document = documentMock;
global.window = windowMock;

// Mock dependencies
global.showGlassToast = () => {};
global.openModal = () => {};
global.closeModal = () => {};
global.registerKeyboardListener = () => {};
global.registerModalOverlayEntries = () => {};
global.attachModalListeners = () => {};

// Load the script
const scriptContent = fs.readFileSync('public/scripts/comp/directorLearningAdmin.js', 'utf8');

// Run the script in the context
eval(scriptContent);

assert.strictEqual(typeof showDirectorFeedbackModal, 'function');
assert.strictEqual(typeof saveDirectorFeedback, 'function');
assert.strictEqual(typeof closeDirectorFeedbackModal, 'function');
assert.strictEqual(typeof initDirectorLearningAdminListenerScope, 'function');

assert.strictEqual(typeof showDirectorRulesManager, 'undefined');
assert.strictEqual(typeof loadDirectorRules, 'undefined');
assert.strictEqual(typeof renderDirectorRulesList, 'undefined');
assert.strictEqual(typeof setupDirectorViewDropdown, 'undefined');

// Execute the initialization logic
initDirectorLearningAdminListenerScope();

console.log("Test passed!");
