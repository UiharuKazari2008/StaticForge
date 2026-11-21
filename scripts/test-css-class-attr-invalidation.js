#!/usr/bin/env node
/**
 * A [class^=...] / [class*=...] attribute selector in a compound that is not the rightmost one, followed by a
 * descendant or child part, makes Chrome schedule that descendant part on every class change of ANY element:
 * `.toolbar [class^="btn-"] i` restyled every <i> inside a window at each focus click (#998). Write the class
 * list out instead (`:is(.btn-secondary, ...)`, same specificity). Sibling parts (`+`, `~`) and phone sheets
 * listed below are left. Also checks that the toolbar's button list still covers every btn-* class that
 * starts a class attribute in the sources, so the :is() list matches what [class^="btn-"] matched.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');

const ALLOWED = new Set(['public/css/wm-dsap.css']); // Melaton Mobile DSAP pages, not the desktop

function cssFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? cssFiles(full) : (e.name.endsWith('.css') ? [full] : []);
    });
}
function splitTop(text) {
    const out = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 0) { out.push(text.slice(from, i)); from = i + 1; }
    }
    out.push(text.slice(from));
    return out;
}
const strip = (s) => s.replace(/:(?:is|not|has|where)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, '');
const offenders = [];
for (const file of cssFiles(path.join(root, 'public/css'))) {
    const rel = path.relative(root, file);
    if (ALLOWED.has(rel)) continue;
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const prelude of css.match(/[^{}]+(?=\{)/g) || []) {
        if (prelude.trim().startsWith('@')) continue;
        for (const sel of splitTop(prelude)) {
            // descendant or child combinator after the class attribute selector's compound
            if (/\[class[\^*$|~]?=["'][^"']*["']\][^\s>+~,]*(\s*>\s*|\s+)(?![+~])\S/.test(strip(sel).trim())) offenders.push(`${rel}: ${sel.trim().replace(/\s+/g, ' ').slice(0, 160)}`);
        }
    }
}
assert.deepStrictEqual(offenders, [], `class attribute selectors with a descendant part (write the classes out):\n${offenders.join('\n')}`);

// the list the toolbar uses in place of [class^="btn-"]
const toolbar = fs.readFileSync(path.join(root, 'public/css/modal-window-title-toolbar.css'), 'utf8');
const m = toolbar.match(/:is\((\.btn-secondary[^)]*)\) i,/);
assert.ok(m, 'the toolbar icon rule lists its button classes');
const listed = new Set(m[1].split(',').map((s) => s.trim().slice(1)));
const firstTokens = new Set();
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|static_images/.test(full)) walk(full); return; }
    if (!/\.(js|html)$/.test(e.name) || /\.min\./.test(e.name)) return;
    for (const hit of fs.readFileSync(full, 'utf8').matchAll(/(?:class=\\?["']|className\s*=\s*[`'"])(btn-[a-z-]+)/g)) firstTokens.add(hit[1]);
});
walk(path.join(root, 'public'));
const missing = [...firstTokens].filter((c) => !listed.has(c));
assert.deepStrictEqual(missing, [], `btn-* classes that start a class attribute but are not in the toolbar :is() list: ${missing.join(', ')}`);
console.log('test-css-class-attr-invalidation: ok');
