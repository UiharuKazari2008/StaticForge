const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Mock browser globals needed by toastManager.js
global.window = {
    isDesktop: false
};
global.document = {
    body: { classList: { contains: () => false } },
    getElementById: () => null,
    createElement: () => ({
        className: '',
        setAttribute: () => {},
        appendChild: () => {}
    })
};
global.localStorage = {
    getItem: () => null,
    setItem: () => {}
};
global.setTimeout = (fn) => fn();
global.clearTimeout = () => {};
global.requestAnimationFrame = (fn) => fn();

// Load toastManager.js
const toastManagerCode = fs.readFileSync(
    path.join(__dirname, '../public/scripts/comp/toastManager.js'),
    'utf8'
);

eval(toastManagerCode);

// Test 1: generateButtonsHtml registers button handler with numeric ID
let clicked = false;
let receivedToastId = null;

const buttons = [
    {
        text: 'Test Button',
        onClick: (id) => {
            clicked = true;
            receivedToastId = id;
        }
    }
];

const buttonsEl = generateButtonsHtml(buttons, 'toast-1');
assert.ok(buttonsEl, 'generateButtonsHtml should return element');

// Test 2: Invoke handleToastButtonClick with a STRING argument (simulating DOM onclick="handleToastButtonClick('1')")
handleToastButtonClick('1');

assert.strictEqual(clicked, true, 'Handler should be triggered when called with string button ID');
assert.strictEqual(receivedToastId, 'toast-1', 'Handler should receive correct toastId');

console.log('✅ test-toast-button-click passed!');
