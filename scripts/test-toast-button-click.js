// JULES: Unit test for handleToastButtonClick Map lookup fix
const assert = require('assert');
const fs = require('fs');

// Mock browser globals needed by public/scripts/comp/toastManager.js
global.window = {};
global.document = {
    getElementById: () => null,
    body: {
        classList: { contains: () => false },
        appendChild: () => {}
    },
    createElement: () => ({
        className: '',
        textContent: '',
        setAttribute: () => {},
        appendChild: () => {}
    })
};
global.localStorage = {
    getItem: () => null,
    setItem: () => {}
};

// Evaluate toastManager script content in global context
const toastManagerCode = fs.readFileSync('public/scripts/comp/toastManager.js', 'utf8');
eval(toastManagerCode);

let clickedToastId = null;
const testButtons = [
    {
        text: 'Action',
        onClick: (toastId) => {
            clickedToastId = toastId;
        }
    }
];

// Generate button HTML / register handler
const toastId = 'toast-test-1';
const buttonsContainer = generateButtonsHtml(testButtons, toastId);

assert(buttonsContainer, 'generateButtonsHtml should return an element');

// Trigger button click using string id (simulating DOM onclick attribute)
handleToastButtonClick('1');

assert.strictEqual(clickedToastId, toastId, 'handleToastButtonClick should execute callback when called with string buttonId');

console.log('✅ test-toast-button-click passed successfully!');
