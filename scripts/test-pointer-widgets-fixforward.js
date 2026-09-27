#!/usr/bin/env node
/**
 * #248 regressions: bias preview keeps the image aspect ratio for tall images,
 * and customScrollbar deep-scans every added/removed subtree for scroll hosts.
 * Run: node scripts/test-pointer-widgets-fixforward.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const compDir = path.join(__dirname, '../public/scripts/comp');
const read = (name) => fs.readFileSync(path.join(compDir, name), 'utf8');

function extractBlock(src, header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, `missing ${header}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced ${header}`);
}

// Bias preview layout
const biasCtx = { imageBiasAdjustmentData: {} };
vm.createContext(biasCtx);
vm.runInContext(extractBlock(read('imageBias.js'), 'function rebuildBiasAdjustmentLayout('), biasCtx);
const rebuildLayout = vm.runInContext('rebuildBiasAdjustmentLayout', biasCtx);

function layoutFor(image, target) {
    biasCtx.imageBiasAdjustmentData.originalImage = image;
    biasCtx.imageBiasAdjustmentData.targetDimensions = target;
    const dom = {
        container: { getBoundingClientRect: () => ({ width: 1064, height: 1064 }) },
        targetBorder: { style: {} },
        image: { style: {} }
    };
    rebuildLayout(dom);
    return { width: parseFloat(dom.image.style.width), height: parseFloat(dom.image.style.height) };
}

const tall = layoutFor({ width: 500, height: 1000 }, { width: 1000, height: 1000 });
assert.strictEqual(tall.width, 1000, 'tall image fills target width');
assert.strictEqual(tall.height, 2000, 'tall image height = width / imageAR');
const wide = layoutFor({ width: 2000, height: 1000 }, { width: 1000, height: 1000 });
assert.deepStrictEqual(wide, { width: 2000, height: 1000 }, 'wide image unchanged');
console.log('ok: bias preview aspect ratio');

// customScrollbar subtree scan
const scrollSrc = read('customScrollbar.js');
const scrollCtx = { Node: { ELEMENT_NODE: 1 } };
vm.createContext(scrollCtx);
vm.runInContext(`const holder = {
${extractBlock(scrollSrc, '    shouldHaveScrollbar(element) {')},
${extractBlock(scrollSrc, '    _initScrollHostsInNode(node) {')},
${extractBlock(scrollSrc, '    _teardownScrollHostsInNode(node) {')}
};`, scrollCtx);
const holder = vm.runInContext('holder', scrollCtx);

function el(name, { host = false, children = [] } = {}) {
    const node = {
        name,
        nodeType: 1,
        classList: { contains: () => false, [Symbol.iterator]: function* () {} },
        hasAttribute: (attr) => host && attr === 'data-custom-scrollbar',
        firstElementChild: children[0] || null,
        querySelectorAll(selector) {
            const out = [];
            const walk = (n) => n.children.forEach((c) => {
                if (c.host && !selector.startsWith('.form-section-scroll')) out.push(c);
                walk(c);
            });
            walk(node);
            return out;
        },
        children,
        host
    };
    return node;
}

const nested = el('nested-host', { host: true });
const wrapper = el('plain-wrapper', { children: [el('panel', { children: [nested] })] });

const scrollbars = new Map();
const scrollbar = Object.assign(Object.create(holder), {
    scrollbars,
    createScrollbar(node) { scrollbars.set(node, {}); },
    destroy(node) { scrollbars.delete(node); }
});

scrollbar._initScrollHostsInNode(wrapper);
assert.ok(scrollbars.has(nested), 'nested host under a plain wrapper gets a scrollbar');
scrollbar._teardownScrollHostsInNode(wrapper);
assert.strictEqual(scrollbars.size, 0, 'nested host under a plain wrapper is torn down');
console.log('ok: customScrollbar deep-scans added/removed subtrees');

console.log('\ntest-pointer-widgets-fixforward: all passed');
