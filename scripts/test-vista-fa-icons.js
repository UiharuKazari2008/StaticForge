#!/usr/bin/env node
/**
 * public/css/vista-fa-icons.css matches scripts/generate-vista-fa-icons.js, every picture it names
 * exists (app_icons/16/*.webp are built at runtime from the app_icons/<name>.png masters), and
 * contextMenu.js still stamps data-menu-text for the shared-glyph items.
 * Run: node scripts/test-vista-fa-icons.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { build, MAP, OVERRIDES } = require('./generate-vista-fa-icons');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const css = fs.readFileSync(path.join(PUBLIC, 'css', 'vista-fa-icons.css'), 'utf8');
assert.strictEqual(css, build().css, 'vista-fa-icons.css is stale: run node scripts/generate-vista-fa-icons.js');

function exists(url) {
    const runtimeIcon = url.match(/^\/static_images\/app_icons\/\d+\/(.+)\.webp$/);
    if (runtimeIcon) return fs.existsSync(path.join(PUBLIC, 'static_images', 'app_icons', runtimeIcon[1] + '.png'));
    return fs.existsSync(path.join(PUBLIC, url));
}

const urls = new Set([...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]));
const missing = [...urls].filter((url) => !exists(url));
assert.deepStrictEqual(missing, [], 'pictures missing: ' + missing.join(', '));

const html = fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8');
assert.ok(html.includes('href="/css/vista-fa-icons.css"'), 'app.html links vista-fa-icons.css');

const menuJs = fs.readFileSync(path.join(PUBLIC, 'scripts', 'comp', 'contextMenu.js'), 'utf8');
assert.ok(/itemElement\.dataset\.menuText = item\.text/.test(menuJs), 'contextMenu.js sets data-menu-text');

console.log(`ok: ${MAP.length} pictures, ${OVERRIDES.length} shared-glyph items, ${urls.size} files present`);
