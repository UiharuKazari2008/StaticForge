const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const targetPath = path.join(__dirname, '../public/scripts/comp/inpaint.js');
const appHtmlPath = path.join(__dirname, '../public/app.html');

// 1. Verify files exist
assert.strictEqual(fs.existsSync(targetPath), true, 'inpaint.js must exist');
assert.strictEqual(fs.existsSync(appHtmlPath), true, 'app.html must exist');

// 2. Verify in app.html that cancelMaskBtn exists and closeMaskEditorBtn does NOT exist
const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
assert.strictEqual(appHtml.includes('closeMaskEditorBtn'), false, 'closeMaskEditorBtn should not exist in app.html');
assert.strictEqual(appHtml.includes('cancelMaskBtn'), true, 'cancelMaskBtn must exist in app.html');

// 3. Mock DOM environment and run initializeMaskEditor
const queriedIds = [];
const eventListeners = {};

class MockElement {
    constructor(id) {
        this.id = id;
        this.classList = {
            add: () => {},
            remove: () => {},
            contains: () => false
        };
        this.style = {};
        this.width = 100;
        this.height = 100;
    }
    getContext() {
        return {};
    }
    setAttribute() {}
    getAttribute() {
        return null;
    }
    addEventListener(event, handler) {
        eventListeners[`${this.id}:${event}`] = handler;
    }
    removeEventListener() {}
}

const mockDocument = {
    getElementById(id) {
        queriedIds.push(id);
        if (id === 'closeMaskEditorBtn') {
            return null;
        }
        return new MockElement(id);
    },
    querySelector() {
        return new MockElement('query');
    },
    createElement(tag) {
        return new MockElement(tag);
    },
    body: {
        appendChild: () => {}
    }
};

let closeModalCalled = false;
const sandbox = {
    document: mockDocument,
    window: {
        wsClient: {
            registerInitStep: () => {}
        }
    },
    console,
    createWheelTickGate: () => () => true,
    manualNoiseValue: null,
    manualStrengthValue: null,
    variationImage: null,
    closeModal: async () => {
        closeModalCalled = true;
    },
    setTimeout: () => {}
};

vm.createContext(sandbox);

// Load inpaint.js script in sandbox
const scriptCode = fs.readFileSync(targetPath, 'utf8');
vm.runInContext(scriptCode, sandbox);

// Run initializeMaskEditor
sandbox.initializeMaskEditor();

// Assert that closeMaskEditorBtn was NOT queried
assert.strictEqual(
    queriedIds.includes('closeMaskEditorBtn'),
    false,
    'initializeMaskEditor should not query for non-existent closeMaskEditorBtn'
);

// Assert that cancelMaskBtn was wired and its click triggers closeModal
assert.strictEqual(typeof eventListeners['cancelMaskBtn:click'], 'function', 'cancelMaskBtn click handler must be wired');
eventListeners['cancelMaskBtn:click']();
assert.strictEqual(closeModalCalled, true, 'cancelMaskBtn click should call closeMaskEditor / closeModal');

console.log('test-mask-editor-close-dead-handle passed successfully!');
