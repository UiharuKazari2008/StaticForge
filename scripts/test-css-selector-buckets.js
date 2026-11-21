#!/usr/bin/env node
/**
 * A rule whose last compound is a bare `:is(.a, .b, ...)` lands in Chrome's universal bucket: it is tried on every
 * element restyled anywhere, where `.a, .b` as a selector list is only tried on elements with that class. Writing
 * them out (same specificity: every argument is one class) took ~20% off the style time of a window focus click on
 * the desktop (#1001: 296 selectors in 279 rules). Keep new rules written out.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');

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
function lastCompound(sel) {
    let depth = 0;
    for (let i = sel.length - 1; i >= 0; i--) {
        const c = sel[i];
        if (c === ')' || c === ']') depth++;
        else if (c === '(' || c === '[') depth--;
        else if (depth === 0 && /[\s>+~]/.test(c)) return sel.slice(i + 1);
    }
    return sel;
}
/** a bare all-class :is() opening the last compound */
function unbucketed(sel) {
    const m = lastCompound(sel.trim()).match(/^:is\(([^()]*)\)(.*)$/);
    if (!m || /:is\(|:where\(/.test(m[2])) return false;
    const args = splitTop(m[1]).map((a) => a.trim());
    return args.length > 1 && args.every((a) => /^\.[\w-]+$/.test(a));
}
assert.ok(unbucketed('.x :is(.a, .b)'), 'catches a bare class :is() at the end');
assert.ok(unbucketed('.x > :is(.a, .b)::before'), 'with a pseudo-element after it');
assert.ok(!unbucketed('.x :is(.a, #b)'), 'not with an id (specificity would change)');
assert.ok(!unbucketed('.x .y:is(.a, .b)'), 'not when a class buckets the compound already');
assert.ok(!unbucketed(':is(.a .b, .c)'), 'not with a complex argument');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(d, e.name);
    return e.isDirectory() ? walk(full) : (e.name.endsWith('.css') ? [full] : []);
});
const offenders = [];
for (const file of walk(path.join(root, 'public/css'))) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const prelude of css.match(/[^{}]+(?=\{)/g) || []) {
        if (prelude.trim().startsWith('@')) continue;
        for (const sel of splitTop(prelude)) if (unbucketed(sel)) offenders.push(`${path.relative(root, file)}: ${sel.trim().replace(/\s+/g, ' ').slice(0, 140)}`);
    }
}
// sheets other sessions were editing when the split ran (#1001); written out when next touched
const LEFT = new Set(['public/css/vista-menus.css', 'public/css/themes/vista/xmradio.css', 'public/css/wm-xmradio.css']);
const fresh = offenders.filter((o) => !LEFT.has(o.split(':')[0]));
assert.deepStrictEqual(fresh, [], `write these :is() lists out as selector lists:\n${fresh.join('\n')}`);
console.log(`test-css-selector-buckets: ok (${offenders.length} left in sheets other sessions were editing)`);
