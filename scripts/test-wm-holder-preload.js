#!/usr/bin/env node
/**
 * The "..." holder's pictures are preloaded (#1245): holderArtUrl picks the image-set URL for the screen's density,
 * and the preloader is wired to renderNotes / holderAskServer without timers or data: URLs.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SHELL = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/wmShell.js'), 'utf8');
const start = SHELL.indexOf('function holderArtUrl(');
const end = SHELL.indexOf('function preloadHolderArt(');
assert(start > 0 && end > start, 'holderArtUrl not found');

function pick(dpr, str) {
    const ctx = { window: { devicePixelRatio: dpr }, location: { href: 'https://x.test/app/' }, URL };
    vm.createContext(ctx);
    vm.runInContext(`${SHELL.slice(start, end)}\nthis.f = holderArtUrl;`, ctx);
    return ctx.f(str);
}
const set = (n4) => `image-set(url("/static_images/a.png") 1x, url("/static_images/a@2x.png") 2x${n4 ? ', url("/static_images/a@4x.png") 4x' : ''})`;
const U = (f) => `https://x.test/static_images/${f}`;
assert.strictEqual(pick(1, set(true)), U('a.png'));
assert.strictEqual(pick(2, set(true)), U('a@2x.png'));
assert.strictEqual(pick(2.625, set(true)), U('a@4x.png'));
assert.strictEqual(pick(5, set(true)), U('a@4x.png'));
assert.strictEqual(pick(3, set(false)), U('a@2x.png'));
assert.strictEqual(pick(0, set(true)), U('a.png'));
assert.strictEqual(pick(2, 'url("/static_images/b.png")'), U('b.png'));
assert.strictEqual(pick(2, 'garbage'), '');
assert.strictEqual(pick(2, ''), '');
assert.strictEqual(pick(2, null), '');

const pre = SHELL.slice(SHELL.indexOf('const holderImages = new Map()'), SHELL.indexOf('function renderNoteBubble()'));
assert(/function preloadHolderArt\(/.test(pre) && /function scheduleHolderPreload\(/.test(pre));
assert(!/data:/.test(pre) && !/setInterval/.test(pre) && !/fetch\(/.test(pre), 'preloader must not use data:, setInterval or fetch');
const fn = (name) => { const i = SHELL.indexOf(`function ${name}(`); return SHELL.slice(i, SHELL.indexOf('\n    }\n', i)); };
assert(/scheduleHolderPreload\(\)/.test(fn('renderNotes')), 'renderNotes schedules the preload');
assert(/holderServer = next;\s*scheduleHolderPreload\(\)/.test(fn('holderAskServer')), 'holderAskServer schedules the preload');
console.log('test-wm-holder-preload: ok');
