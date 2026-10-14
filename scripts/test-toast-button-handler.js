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
global.desktopSounds = {
    playBalloon: () => {}
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

// Simulate button click via global window.handleToastButtonClick with numeric ID
// Next button ID for first button is 1
global.window.handleToastButtonClick(1);

assert.strictEqual(clickedToastId, toastId, 'handleToastButtonClick should trigger button callback with numeric ID');

// Test clicking a toast button with string ID (as passed from DOM inline onclick attribute)
let clickedToastId2 = null;
const toastId2 = showGlassToast('info', 'Test Title 2', 'Test Message 2', false, false, null, [
    {
        text: 'Action 2',
        onClick: (id) => {
            clickedToastId2 = id;
        }
    }
]);

assert.ok(toastId2, 'showGlassToast should return a toastId for second toast');

// Next button ID for second button is 2, pass as string '2'
global.window.handleToastButtonClick('2');

assert.strictEqual(clickedToastId2, toastId2, 'handleToastButtonClick should trigger button callback when passed string ID');

console.log('✅ test-toast-button-handler.js passed');
