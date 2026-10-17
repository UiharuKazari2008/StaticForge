const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock DOM/Browser environment
global.window = global;
global.localStorage = {
    getItem: () => null,
    setItem: () => {}
};
global.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
};

// Functions referenced in dynamicGenerationOverrides.js
global.updateRentanContextOverlay = () => {};
global.resolvePreviewRentanContext = () => null;

// Read and execute dynamicGenerationOverrides.js in current context
const code = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/dynamicGenerationOverrides.js'), 'utf8');
eval(code);

// Assert window.togglePeriodDetails is exported properly
assert.strictEqual(typeof window.togglePeriodDetails, 'function', 'window.togglePeriodDetails should be defined as a function');

// Test togglePeriodDetails functionality
let toggledHidden = false;
let toggledExpanded = false;

const dummyElement = {
    closest: (selector) => {
        if (selector === '.period-info-content') {
            return {
                querySelector: (subSelector) => {
                    if (subSelector === '.period-details') {
                        return {
                            classList: {
                                toggle: (cls) => {
                                    if (cls === 'hidden') toggledHidden = true;
                                }
                            }
                        };
                    }
                    return null;
                }
            };
        }
        return null;
    },
    querySelector: (selector) => {
        if (selector === '.period-expand-icon') {
            return {
                classList: {
                    toggle: (cls) => {
                        if (cls === 'expanded') toggledExpanded = true;
                    }
                }
            };
        }
        return null;
    }
};

window.togglePeriodDetails(dummyElement);

assert.strictEqual(toggledHidden, true, 'periodDetails classList toggle hidden should have been called');
assert.strictEqual(toggledExpanded, true, 'icon classList toggle expanded should have been called');

console.log('test-toggle-period-details.js: All assertions passed!');
