#!/usr/bin/env node
// Rewrite cursor: <keyword> to cursor: var(--c-keyword) across public CSS/JS/HTML.
// Leaves inherit/unset/initial/revert, var(), url(), and vendor prefixes.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const SKIP_NAMES = new Set(['desktop-cursors.css']);
const KEYWORDS = new Set([
    'auto', 'default', 'none', 'context-menu', 'help', 'pointer', 'progress', 'wait',
    'cell', 'crosshair', 'text', 'vertical-text', 'alias', 'copy', 'move', 'no-drop',
    'not-allowed', 'grab', 'grabbing', 'all-scroll', 'col-resize', 'row-resize',
    'n-resize', 'e-resize', 's-resize', 'w-resize', 'ne-resize', 'nw-resize',
    'se-resize', 'sw-resize', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize',
    'zoom-in', 'zoom-out'
]);
const LEAVE = new Set(['inherit', 'unset', 'initial', 'revert', 'revert-layer']);

function retokenizeCss(text) {
    return text.replace(/cursor\s*:\s*([^;{}]+)/gi, (full, value) => {
        const raw = value.trim();
        if (/^var\(/i.test(raw) || /^url\(/i.test(raw)) return full;
        const m = raw.match(/^(-webkit-|-moz-)?([a-z-]+)(\s*!important)?\s*$/i);
        if (!m) return full;
        if (m[1]) return full;
        const kw = m[2].toLowerCase();
        if (LEAVE.has(kw) || !KEYWORDS.has(kw)) return full;
        const important = m[3] ? ' !important' : '';
        return `cursor: var(--c-${kw})${important}`;
    });
}

function retokenizeJsCursorAssign(text) {
    return text.replace(/\.style\.cursor\s*=\s*(['"])([a-z-]+)\1/g, (full, q, kw) => {
        const key = kw.toLowerCase();
        if (!KEYWORDS.has(key)) return full;
        return `.style.cursor = ${q}var(--c-${key})${q}`;
    });
}

function walk(dir, out) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === 'dist') return;
            walk(full, out);
            return;
        }
        if (SKIP_NAMES.has(ent.name)) return;
        if (!/\.(css|js|html)$/.test(ent.name)) return;
        out.push(full);
    });
}

const files = [];
walk(ROOT, files);
let changed = 0;
files.forEach((file) => {
    const before = fs.readFileSync(file, 'utf8');
    let next = retokenizeCss(before);
    if (file.endsWith('.js')) next = retokenizeJsCursorAssign(next);
    if (next !== before) {
        fs.writeFileSync(file, next);
        changed += 1;
        console.log(path.relative(path.join(__dirname, '..'), file));
    }
});
console.log(`retokenize-cursors: ${changed} files`);
