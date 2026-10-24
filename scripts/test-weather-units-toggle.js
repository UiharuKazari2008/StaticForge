const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Global scope mocks
global.window = global;

const localStorageStore = {};
global.localStorage = {
    getItem: (k) => localStorageStore[k] || null,
    setItem: (k, v) => { localStorageStore[k] = String(v); }
};

class MockElement {
    constructor(tagName = 'div', id = '', className = '') {
        this.tagName = tagName;
        this.id = id;
        this.className = className;
        this.dataset = {};
        this.children = [];
        this.parentElement = null;
        this.textContent = '';
        this._attributes = {};
    }

    setAttribute(name, value) { this._attributes[name] = value; }
    getAttribute(name) { return this._attributes[name] || null; }

    querySelector(selector) {
        if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            for (const child of this.children) {
                if (child.className && child.className.includes(cls)) return child;
                const found = child.querySelector(selector);
                if (found) return found;
            }
        } else if (selector.startsWith('#')) {
            const id = selector.slice(1);
            if (this.id === id) return this;
            for (const child of this.children) {
                const found = child.querySelector(selector);
                if (found) return found;
            }
        }
        return null;
    }

    querySelectorAll(selector) {
        const results = [];
        if (selector.startsWith('.')) {
            const cls = selector.split('[')[0].slice(1);
            const search = (node) => {
                if (node.className && node.className.includes(cls)) results.push(node);
                for (const child of node.children) search(child);
            };
            search(this);
        }
        return results;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    closest(selector) {
        let curr = this;
        const cls = selector.slice(1);
        while (curr) {
            if (curr.className && curr.className.includes(cls)) return curr;
            curr = curr.parentElement;
        }
        return null;
    }
}

const docRoot = new MockElement('html', '', '');
const docBody = new MockElement('body', '', '');
docRoot.appendChild(docBody);

global.document = {
    getElementById: (id) => null,
    querySelector: (sel) => docRoot.querySelector(sel),
    querySelectorAll: (sel) => docRoot.querySelectorAll(sel)
};

// Load code from dynamicGenerationOverrides.js
const filePath = path.join(__dirname, '../public/scripts/comp/dynamicGenerationOverrides.js');
const code = fs.readFileSync(filePath, 'utf8');

// Evaluate in global scope
eval(code);

console.log('Testing toggleWeatherUnits without overlay functions defined...');

// Test case 1: Overlay functions undefined (should not throw when fixed)
try {
    global.window.toggleWeatherUnits({ target: null });
    console.log('✅ Case 1 passed: toggleWeatherUnits executed without throwing when overlay functions are undefined.');
} catch (err) {
    console.error('❌ Case 1 failed with error:', err);
    process.exit(1);
}

// Test case 2: Overlay functions defined (should invoke them)
let updateRentanCalled = false;
global.updateRentanContextOverlay = function(ctx) {
    updateRentanCalled = true;
};

let resolveRentanCalled = false;
global.resolvePreviewRentanContext = function() {
    resolveRentanCalled = true;
    return { mock: 'context' };
};

try {
    global.window.toggleWeatherUnits({ target: null });
    assert.strictEqual(updateRentanCalled, true, 'updateRentanContextOverlay should be called');
    assert.strictEqual(resolveRentanCalled, true, 'resolvePreviewRentanContext should be called');
    console.log('✅ Case 2 passed: toggleWeatherUnits invoked overlay functions when defined.');
} catch (err) {
    console.error('❌ Case 2 failed with error:', err);
    process.exit(1);
}
