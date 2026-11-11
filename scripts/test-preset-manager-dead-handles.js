'use strict';
/**
 * presetManagerBtn is absent from HTML and no longer looked up;
 * initializePresetDropdowns is unused and removed.
 * Credit: grok.menma
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/presetManager.js'), 'utf8');
const htmlDir = path.join(__dirname, '../public');

function walkHtml(dir, acc) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
            if (name === 'node_modules') continue;
            walkHtml(p, acc);
        } else if (name.endsWith('.html')) acc.push(fs.readFileSync(p, 'utf8'));
    }
    return acc;
}
const html = walkHtml(htmlDir, []).join('\n');

assert.strictEqual(html.includes('presetManagerBtn'), false, 'presetManagerBtn must not exist in HTML');
assert.strictEqual(src.includes('presetManagerBtn'), false, 'presetManagerBtn lookup must be gone');
assert.strictEqual(/function\s+initializePresetDropdowns\s*\(/.test(src), false, 'initializePresetDropdowns must be removed');
assert.strictEqual(src.includes('initializePresetDropdowns'), false, 'initializePresetDropdowns must have no remaining references');
assert.ok(src.includes('function initializePresetManager'), 'initializePresetManager must remain');
assert.ok(src.includes('function showPresetManager') || src.includes('async function showPresetManager'), 'showPresetManager must remain');

console.log('PASS: test-preset-manager-dead-handles');
