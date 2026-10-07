const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock DOM element factory
function mockElement(tagName = 'div') {
    const children = [];
    return {
        tagName,
        className: '',
        style: {},
        innerHTML: '',
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false
        },
        setAttribute: () => {},
        appendChild: (child) => { children.push(child); return child; },
        prepend: (child) => { children.unshift(child); return child; },
        querySelector: () => null,
        querySelectorAll: () => []
    };
}

// Mock a Minimal Browser Window environment
global.window = {
    AndroidNotification: null,
    isDesktop: false,
    localStorage: {
        getItem: () => null,
        setItem: () => {}
    },
    requestAnimationFrame: (cb) => cb()
};
global.requestAnimationFrame = global.window.requestAnimationFrame;

global.document = {
    body: {
        classList: {
            contains: () => false
        },
        appendChild: () => {}
    },
    getElementById: () => null,
    createElement: (tag) => mockElement(tag)
};

// Read and evaluate toastManager.js
const toastManagerCode = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/toastManager.js'), 'utf8');
eval(toastManagerCode);

// Verify window.handleToastButtonClick is exposed
assert.strictEqual(typeof global.window.handleToastButtonClick, 'function', 'window.handleToastButtonClick must be a function');

// Test clicking a toast button
let clickedToastId = null;
const toastId = showGlassToast('info', 'Test Title', 'Test Message', false, false, null, [
    {
        text: 'Action',
        onClick: (id) => {
            clickedToastId = id;
        }
    }
]);

assert.ok(toastId, 'showGlassToast should return a toastId');

// Simulate button click via global window.handleToastButtonClick
// Next button ID for first button is 1
global.window.handleToastButtonClick(1);

assert.strictEqual(clickedToastId, toastId, 'handleToastButtonClick should trigger button callback with toastId');

console.log('✅ test-toast-button-handler.js passed');
