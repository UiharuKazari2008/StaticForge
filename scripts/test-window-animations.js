#!/usr/bin/env node
// Slice 4 of the MeletonFX plan (Yozora #441): Aero window animations. Open / close / minimize
// keyframes live with their rules in app.css, Vista timings come from tokens, reduced motion
// keeps animationend alive, and maximize / restore morph the frame (FLIP on translate / scale).
// Run: node scripts/test-window-animations.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const src = read('public/scripts/comp/modalUtils.js');
const appCss = read('public/css/app.css');

function extractBlock(text, header) {
    const start = text.indexOf(header);
    assert.ok(start >= 0, `missing ${header}`);
    let depth = 0;
    for (let i = text.indexOf('{', start); i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    throw new Error(`unbalanced ${header}`);
}

// 1. One home for the window keyframes, next to the rules that use them.
const names = ['modalSlideIn', 'modalSlideInTopAnchor', 'modalSlideOut', 'modalSlideOutTopAnchor',
    'modalFadeIn', 'modalFadeOut', 'modalMinimize', 'modalUnminimize'];
const cssDir = path.join(root, 'public/css');
fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')).forEach((f) => {
    const text = fs.readFileSync(path.join(cssDir, f), 'utf8');
    names.forEach((n) => {
        const count = (text.match(new RegExp(`@keyframes ${n}\\s*\\{`, 'g')) || []).length;
        assert.strictEqual(count, f === 'app.css' ? 1 : 0, `@keyframes ${n} in ${f}`);
    });
});

// 2. Vista timings from tokens; open grows from 90 %.
const root_ = extractBlock(appCss, ':root {\n    --window-open-duration');
assert.ok(/--window-open-duration:\s*0\.25s/.test(root_), 'open 250 ms');
assert.ok(/--window-close-duration:\s*0\.15s/.test(root_), 'close 150 ms');
assert.ok(/--window-minimize-duration:\s*0\.25s/.test(root_), 'minimize 250 ms');
assert.ok(/--window-morph-duration:\s*180ms/.test(root_), 'maximize morph 180 ms');
['.modal.opening {', '.modal.closing {', '.modal.minimising {', '.modal.unminimising {',
    '.modal[data-window-content-anchor="top"].opening {', '.modal[data-window-content-anchor="top"].closing {']
    .forEach((sel) => assert.ok(/var\(--window-(open|close|minimize)-duration\)/.test(extractBlock(appCss, sel)), `${sel} reads a timing token`));
const slideIn = extractBlock(appCss, '@keyframes modalSlideIn {');
assert.ok(slideIn.includes('scale(0.86)') && slideIn.includes('rotateX'), 'open swings forward from 86 % (Vista)');
names.forEach((n) => {
    const kf = extractBlock(appCss, `@keyframes ${n} {`).replace(/\/\*[\s\S]*?\*\//g, '');
    const props = Array.from(kf.matchAll(/^\s*([a-z-]+)\s*:/gm)).map((m) => m[1]);
    props.forEach((p) => assert.ok(p === 'opacity' || p === 'transform', `${n} animates ${p} (compositor only)`));
});

// 3. Reduced motion: 1 ms animations (animationend still fires), no morph.
const reduced = appCss.slice(appCss.indexOf('@media (prefers-reduced-motion: reduce)'));
assert.ok(reduced.length > 0, 'reduced-motion block');
const reducedRoot = extractBlock(reduced, ':root {');
['open', 'close', 'minimize'].forEach((k) => assert.ok(new RegExp(`--window-${k}-duration:\\s*1ms`).test(reducedRoot), `reduced ${k} = 1ms`));
assert.ok(/--window-morph-duration:\s*0ms/.test(reducedRoot), 'reduced morph off');

// 4. FLIP maths: the morph puts the new box exactly onto the old one.
class DOMMatrixReadOnly {
    constructor(str) {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        if (!str) return;
        const m = str.match(/^matrix\(([^)]+)\)$/);
        assert.ok(m, `stub parses ${str}`);
        [this.a, this.b, this.c, this.d, this.e, this.f] = m[1].split(',').map(Number);
    }
}
const ctx = { DOMMatrixReadOnly, Math, Number, String, parseFloat };
vm.createContext(ctx);
vm.runInContext(extractBlock(src, 'function computeModalRectMorph(') + '\nthis.computeModalRectMorph = computeModalRectMorph;', ctx);

// Apply individual translate + scale about the origin, then the element's own translation,
// to a point of the laid-out box, the way CSS composes them.
function project(morph, style, toRect, px, py) {
    const m = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const [ox, oy] = style.transformOrigin.split(' ').map(parseFloat);
    const layoutLeft = toRect.left - m.e;
    const layoutTop = toRect.top - m.f;
    const Ox = layoutLeft + ox;
    const Oy = layoutTop + oy;
    const x = px + m.e;
    const y = py + m.f;
    return [Ox + morph.dx + morph.sx * (x - Ox), Oy + morph.dy + morph.sy * (y - Oy)];
}
function checkMorph(from, to, style, label) {
    const morph = ctx.computeModalRectMorph(from, to, style);
    assert.ok(morph, `${label}: morph`);
    const m = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const lx = to.left - m.e;
    const ly = to.top - m.f;
    const [x0, y0] = project(morph, style, to, lx, ly);
    const [x1, y1] = project(morph, style, to, lx + to.width, ly + to.height);
    [[x0, from.left], [y0, from.top], [x1, from.left + from.width], [y1, from.top + from.height]].forEach(([got, want], i) =>
        assert.ok(Math.abs(got - want) < 1e-6, `${label}: corner ${i} ${got} vs ${want}`));
}
const work = { left: 0, top: 29, width: 1920, height: 1136 };
const normal = { left: 241, top: 384, width: 799, height: 688 };
// Maximize: pixel-settled box (transform translateZ(0) → identity), centre origin
checkMorph(normal, work, { transform: 'matrix(1, 0, 0, 1, 0, 0)', transformOrigin: '960px 568px' }, 'maximize, settled');
// Restore: centre-anchored box (translate(-50%, -50%))
checkMorph(work, normal, { transform: 'matrix(1, 0, 0, 1, -399.5, -344)', transformOrigin: '399.5px 344px' }, 'restore, centre anchor');
// Top-left origin
checkMorph(normal, work, { transform: 'none', transformOrigin: '0px 0px' }, 'maximize, top-left origin');
assert.strictEqual(ctx.computeModalRectMorph(normal, work, { transform: 'matrix(0.9, 0, 0, 0.9, 0, 0)', transformOrigin: '0px 0px' }), null,
    'skipped while another animation scales the window');
assert.strictEqual(ctx.computeModalRectMorph(normal, { ...normal }, { transform: 'none', transformOrigin: '0px 0px' }), null, 'no-op rect');

// 5. Wiring: user maximize / restore morphs; the drag restore and viewport re-layout do not.
const toggle = extractBlock(src, 'function toggleModalMaximize(');
assert.ok(/playModalRectMorph\(modal, fromRect\)/.test(toggle), 'toggle morphs');
assert.ok(!/playModalRectMorph/.test(extractBlock(src, 'function restoreMaximizedModalUnderPointer(')), 'drag restore follows the pointer, no morph');
assert.ok(!/playModalRectMorph/.test(extractBlock(src, 'function maximizeModalToWorkArea(')), 'primitive stays instant (viewport re-layout)');
assert.ok(/finishModalRectMorph\(modal\)/.test(toggle), 'a new toggle lands the running morph first');
['function handleModalDragStart(', 'function handleModalResizeStart('].forEach((h) =>
    assert.ok(/finishModalRectMorph\(modal\)/.test(extractBlock(src, h)), `${h} measures the landed box`));
{
    const clamp = extractBlock(src, 'function ensureModalEdgesWithinWorkArea(');
    assert.ok(/morph\.finished\.then\(/.test(clamp), 'work-area clamp waits for the morph (it used to clamp to the scaled box)');
    assert.ok(/playState === 'running'/.test(clamp), 'only waits on a running morph (a finished one looped the microtask queue and froze the tab)');
    assert.ok(/modal\._rectMorph = null/.test(clamp), 'clears the landed morph before re-measuring');
}
const tctx = { Number, parseFloat, String };
vm.createContext(tctx);
vm.runInContext(extractBlock(src, 'function parseCssTimeMs(') + '\nthis.parseCssTimeMs = parseCssTimeMs;', tctx);
assert.strictEqual(tctx.parseCssTimeMs(' 180ms'), 180, 'ms');
assert.strictEqual(tctx.parseCssTimeMs('.18s'), 180, 'minified seconds');
assert.strictEqual(tctx.parseCssTimeMs('0ms'), 0, 'off');
const play = extractBlock(src, 'function playModalRectMorph(');
assert.ok(/--window-morph-duration/.test(play), 'morph reads the timing token');
assert.ok(/translate:/.test(play) && /scale:/.test(play) && !/transform:/.test(play), 'morph animates translate / scale, not transform');

console.log('test-window-animations: ok');
