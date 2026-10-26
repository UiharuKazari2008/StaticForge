#!/usr/bin/env node
/**
 * applyBiasToText: server (imageGeneration, dynamicGenerationHandlers) and client
 * (manualDropdownManager) copies must scale weights and always close their groups.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = [
    'modules/imageGeneration.js',
    'modules/dynamicGenerationHandlers.js',
    'public/scripts/comp/manualDropdownManager.js'
];

function loadApplyBias(file) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const start = src.indexOf('function applyBiasToText(');
    let depth = 0;
    let end = src.indexOf('{', start);
    for (let i = end; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    const hasManagedEmphasisGroupIds = () => false;
    // eslint-disable-next-line no-new-func
    return new Function('require', 'hasManagedEmphasisGroupIds', `return (${src.slice(start, end + 1)});`)(
        () => ({ hasManagedEmphasisGroupIds }), hasManagedEmphasisGroupIds
    );
}

const CASES = [
    ['not furry, -1::furry::', 1.5, '1.5::not furry::, -1.5::furry::'],
    ['not furry, -1::furry::', 0.5, '0.5::not furry::, -0.5::furry::'],
    ['1.5::nsfw, nude::', 1.2, '1.8::nsfw, nude::'],
    ['1.5::nsfw, nude::', 0.8, '1.2::nsfw, nude::'],
    ['1.5::a::, b, -1::c::', 1.5, '2.3::a::, 1.5::b::, -1.5::c::'],
    ['0.5::nsfw::, rating:questionable', 2, '1.0::nsfw::, 2::rating:questionable::'],
    ['2.0::english text, 3.0::caption, subtitle::', 1.5, '3.0::english text, 4.5::caption, subtitle::'],
    ['nsfw', 1.5, '1.5::nsfw::'],
    ['a, 1.5::open', 2, '2::a::, 3.0::open::'],
    ['anything', 1.0, 'anything']
];

for (const file of FILES) {
    const applyBiasToText = loadApplyBias(file);
    for (const [input, bias, expected] of CASES) {
        assert.strictEqual(applyBiasToText(input, bias), expected, `${file}: ${input} @ ${bias}`);
    }
}
console.log('test-apply-bias-to-text: ok');
