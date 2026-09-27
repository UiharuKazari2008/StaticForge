#!/usr/bin/env node
/**
 * #250 regressions: modal-scoped keyboard listeners work for modals shown
 * without openModal, and the qwen preset token cache keys on optionsData
 * identity (a reloaded payload with the same dataset count invalidates).
 * Run: node scripts/test-modal-presets-fixforward.js
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

// Keyboard registry: modal unhidden directly (no openModal / onModalKeyboardModalOpened).
const kbSrc = read('modalKeyboardRegistry.js');
const mapsStart = kbSrc.indexOf('const keyboardListenerRegistry = new Map();');
const mapsEnd = kbSrc.indexOf('let keyboardRegistryInitialized');
assert.ok(mapsStart >= 0 && mapsEnd > mapsStart, 'registry maps block');

const hidden = new Set(['hidden']);
const galleryWindow = {
    id: 'galleryWindow',
    isConnected: true,
    classList: { contains: (c) => hidden.has(c) }
};
const kbCtx = {
    document: { getElementById: (id) => (id === 'galleryWindow' ? galleryWindow : null) },
    isModalOpenForListeners: (modal) => !!modal && !modal.classList.contains('hidden')
};
vm.createContext(kbCtx);
vm.runInContext([
    kbSrc.slice(mapsStart, mapsEnd),
    ...['isKeyboardListenerActive', 'rememberKeyboardOpenModal', 'resolveKeyboardOpenModal',
        'indexKeyboardListenerEntry', 'pushActiveKeyboardEntriesFromMap',
        'resolveKeyboardListenerEventType', 'keyboardListenerMatchesEventType',
        'collectActiveKeyboardListeners']
        .map((name) => extractBlock(kbSrc, `function ${name}(`))
].join('\n'), kbCtx);

const indexEntry = vm.runInContext('indexKeyboardListenerEntry', kbCtx);
const collect = vm.runInContext('collectActiveKeyboardListeners', kbCtx);
const activeIds = () => Array.from(collect({ type: 'keydown' }), (e) => e.id);

indexEntry({ id: 'gallery.nav', handler() {}, type: 'whenOpen', modalId: 'galleryWindow', priority: 0 });
indexEntry({ id: 'global.help', handler() {}, type: 'global', priority: 0 });
assert.deepStrictEqual(activeIds(), ['global.help'], 'hidden modal listener inactive');

hidden.delete('hidden');
assert.deepStrictEqual(activeIds().sort(), ['gallery.nav', 'global.help'], 'directly unhidden modal listener active');

hidden.add('hidden');
assert.deepStrictEqual(activeIds(), ['global.help'], 'hidden by class again');
hidden.delete('hidden');
assert.deepStrictEqual(activeIds().sort(), ['gallery.nav', 'global.help'], 'reopened without openModal');
console.log('ok: keyboard listeners for modals shown without openModal');

// Preset token cache key
const presetCtx = {
    window: {},
    getPromptTokenizer: () => tokenizer,
    getForgeModelFeatures: () => ({ tokenizer: 'qwen' })
};
const tokenizer = { countTokens: (s) => s.length };
vm.createContext(presetCtx);
vm.runInContext(read('presetTokenCount.js'), presetCtx);
const getMap = vm.runInContext('getPresetTokenCountMap', presetCtx);

presetCtx.window.optionsData = { datasets: [{ value: 'alpha' }] };
const first = getMap();
assert.strictEqual(first.datasets[0].tokens, 'alpha, '.length);
assert.strictEqual(getMap(), first, 'same optionsData object stays cached');

presetCtx.window.optionsData = { datasets: [{ value: 'alpha beta gamma' }] };
const reloaded = getMap();
assert.notStrictEqual(reloaded, first, 'reloaded optionsData with same dataset count invalidates');
assert.strictEqual(reloaded.datasets[0].tokens, 'alpha beta gamma, '.length);
console.log('ok: preset token cache keys on optionsData identity');

console.log('\ntest-modal-presets-fixforward: all passed');
