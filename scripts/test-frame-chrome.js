#!/usr/bin/env node
// Static checks for the shared window chrome (Yozora #404): one source for caption,
// title toolbar and caption-control styling, with documented variants only.
// Run: node scripts/test-frame-chrome.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const SHARED = 'public/css/modal-window-title-toolbar.css';
const CHROME = /\.modal-window-(title|controls)/;
// Files that may style the chrome elements themselves (colour, fill, shadow): the shared
// source, the frame glass engine, the Classic theme, and the documented variants.
const ALLOWED = new Set([
    SHARED,
    'public/css/aero-glass.css',
    'public/css/windows-classic-theme.css',
    'public/css/director.css',          // nested header repeats the popped-out rules (double id, documented)
    'public/css/virtual-keyboard.css',  // floating keyboard: relative drag header, no caption controls
    'public/css/image-prompt-inspector.css', // user-select / cursor on the caption of a selectable window
    'public/css/launch-games.css',      // Setup's games page (/launch-games.html): Vista Basic frames, no desktop chrome loaded (#609)
    'public/css/desktop-apps/vista-jezzball.css', // JezzBall's Windows 3.x caption under Vista (#610)
]);
const COLOUR_PROPS = /^(background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|box-shadow|color|text-shadow|filter|backdrop-filter|-webkit-backdrop-filter|opacity)$/;

function walk(dir, out) {
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((d) => {
        const p = dir + '/' + d.name;
        if (d.isDirectory()) walk(p, out);
        else if (d.name.endsWith('.css')) out.push(p);
    });
    return out;
}

function rules(css) {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(noComments))) {
        // drop any @media / @supports prelude that precedes the first inner selector
        const selector = m[1].split('{').pop().trim();
        const decls = m[2].split(';').map((d) => d.split(':')[0].trim()).filter(Boolean);
        out.push({ selector, decls });
    }
    return out;
}

// 1. The chrome has one source. The old copies are gone.
assert.strictEqual((read('public/css/grimoire-browser.css').match(new RegExp(CHROME.source, 'g')) || []).length, 0,
    'grimoire-browser.css must not declare window chrome rules');
assert.strictEqual((read('public/css/manual-modal-viewer.css').match(new RegExp(CHROME.source, 'g')) || []).length, 0,
    'manual-modal-viewer.css must not declare window chrome rules');

// 2. The link order keeps the cascade position of the moved block.
const html = read('public/app.html');
const hrefs = Array.from(html.matchAll(/href="\/css\/([^"]+)"/g)).map((m) => m[1]);
const i = hrefs.indexOf('modal-window-title-toolbar.css');
assert.ok(i > 0, 'shared chrome stylesheet is linked');
assert.strictEqual(hrefs[i + 1], 'grimoire-browser.css', 'modal-window-title-toolbar.css links directly before grimoire-browser.css');

// 3. The shared file holds the base, the moved matrix, the caption-control tokens and the icon switch.
const shared = read(SHARED);
[
    '.modal-window-title-toolbar {',
    '.modal-window-controls {',
    '.modal-window-title {',
    '.modal.toolbar-visible .modal-window-title-toolbar > [class^="btn-"]',
    '.modal-window-controls button.close-btn',
    '.modal:not(.active-window) .modal-window-title-main',
    'body.user-icons .icon-fa',
    '.modal.toolbar-visible.modal-maximized .modal-window-title',
].forEach((anchor) => assert.ok(shared.includes(anchor), `shared chrome has: ${anchor}`));
assert.ok(!/filter:\s*drop-shadow/.test(shared.replace(/\/\*[\s\S]*?\*\//g, '')), 'captions use text-shadow, not a drop-shadow filter');

// 3b. Aero frame from 7.css + Vista measurements (#407): texture in every glass mode, the 8 px
//     frame border (1 px edge + 7 px inset), client edge lines, caption-button blooms.
{
    const glass = read('public/css/aero-glass.css');
    ['--aero-wedges:', '--aero-streaks:', '--aero-shade:', '--aero-streaks-pos:', '.modal[data-aero-texture="off"]',
        'html[data-glass="live"] body:not(.windows-classic-theme) .modal:not(.alert-theme)']
        .forEach((anchor) => assert.ok(glass.includes(anchor), `aero-glass.css has: ${anchor}`));
    assert.ok(/var\(--aero-streaks\)[\s\S]*var\(--aero-wallpaper, none\)/.test(glass), 'frosted keeps the wallpaper copy under the texture');
    ['--window-frame-inset: 7px;', '--window-frame-inset: 0px;', ':not(.modal-maximized)::after',
        'radial-gradient(circle at bottom, #2aceda, transparent 65%)', 'radial-gradient(circle at 50% 170%, #f4e676 10% 20%, #0000 60%)', '--window-caption-edge: 14px;', '--window-caption-edge: 13px;',
        ':hover:not(:disabled)::before', ':active:not(:disabled)::before']
        .forEach((anchor) => assert.ok(shared.includes(anchor), `shared chrome has: ${anchor}`));
    assert.ok(read('public/scripts/comp/aeroGlass.js').includes('function syncModal(modal) {\n        if (!modal) return false;'),
        'window origin is tracked in every mode (the streaks read it)');
}

// 4. Every caption-control token set on .modal has an inactive counterpart.
const block = (sel) => {
    const m = shared.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, `token block ${sel}`);
    return Array.from(m[1].matchAll(/(--window-[a-z-]+)\s*:/g)).map((x) => x[1]);
};
const active = block('.modal');
const inactive = block('.modal:not(.active-window)');
['--window-control-bg', '--window-control-fg', '--window-control-border', '--window-control-glow',
    '--window-control-close-bg', '--window-control-close-fg', '--window-control-close-glow', '--window-caption-inactive-opacity']
    .forEach((t) => assert.ok(active.includes(t), `active token ${t}`));
active.filter((t) => t.startsWith('--window-control-')).forEach((t) => assert.ok(inactive.includes(t), `inactive counterpart for ${t}`));
['--window-control-bg', '--window-control-fg', '--window-control-border', '--window-control-glow', '--window-control-close-bg', '--window-control-close-glow']
    .forEach((t) => assert.ok(shared.includes(`var(${t})`), `caption controls read ${t}`));
assert.ok(shared.includes('opacity: var(--window-caption-inactive-opacity)'), 'inactive caption reads its opacity token');

// 5. Body fill and caption opacity are design tokens that hold in every glass mode
//    (frosted and basic render live's look cheaper; aero-glass.css paints frames only).
assert.ok(shared.includes('--window-body-bg: var(--glass-windows-full-bg'), 'bodies default to the solid fill');
assert.ok(/#directorWindow\s*\{[^}]*--window-body-bg: var\(--glass-windows-semi-bg/.test(shared), 'Director opts into the glass body');
assert.ok(shared.includes('--window-caption-inactive-opacity: 0.82'), 'inactive caption opacity token');
assert.ok(read('public/css/app.css').includes('background: var(--window-body-bg, var(--glass-windows-semi-bg'), 'app.css body fill reads --window-body-bg');
const aero = read('public/css/aero-glass.css');
assert.ok(!aero.includes('--window-body-bg') && !aero.includes('--window-caption'), 'aero-glass.css paints frames, it does not carry design-only differences');

// 6. No other stylesheet colours the chrome elements themselves (widget sizing inside the toolbar is fine).
const offenders = [];
walk('public/css', []).forEach((file) => {
    if (ALLOWED.has(file)) return;
    rules(read(file)).forEach(({ selector, decls }) => {
        if (!CHROME.test(selector)) return;
        const last = selector.split(/\s*[>+~]\s*|\s+/).pop();
        if (!CHROME.test(last)) return; // targets a widget inside the chrome, not the chrome
        const colour = decls.filter((d) => COLOUR_PROPS.test(d));
        if (colour.length) offenders.push(`${file}: ${selector} {${colour.join(', ')}}`);
    });
});
assert.deepStrictEqual(offenders, [], 'per-app stylesheets must not colour the window chrome');

// 7. Phasewalker: keyword picker, Prompt/UC tabs, add, menu, Compile, in that order, as plain
//    toolbar buttons; the keyword picker and the menu are click context menus, not dropdowns.
const start = html.indexOf('id="bracketGenerationModal"');
const end = html.indexOf('class="modal-content bracket-generation-modal-content', start);
const pw = html.slice(start, end);
const toolbarAt = pw.indexOf('class="modal-window-title-toolbar"');
const controlsAt = pw.indexOf('class="modal-window-controls"');
const order = ['bracketGenKeywordDropdownBtn', 'bracketGenTabButtons', 'bracketGenAddStepBtn', 'bracketGenGearDropdownBtn', 'bracketGenCompileBtn']
    .map((id) => pw.indexOf(`id="${id}"`));
order.forEach((at, i) => assert.ok(at > toolbarAt && at < controlsAt && (i === 0 || at > order[i - 1]), `Phasewalker toolbar order at ${i}`));
assert.ok(!pw.includes('custom-dropdown'), 'Phasewalker has no custom dropdowns left');
const applet = read('public/scripts/comp/bracketGenerationApplet.js');
assert.ok(/attachClickMenuToElement\(btn, this\.keywordClickMenuConfig\)/.test(applet), 'keyword picker is a click context menu');
assert.ok(!/setupDropdown\(/.test(applet), 'Phasewalker no longer uses setupDropdown');

// 8. Atelier keeps every app control on the title toolbar and only window buttons in the cluster.
const ns = html.indexOf('id="naxtModal"');
const ne = html.indexOf('class="modal-content naxt-modal-content', ns);
const naxt = html.slice(ns, ne);
const naxtControls = naxt.slice(naxt.indexOf('class="modal-window-controls"'));
assert.deepStrictEqual(Array.from(naxtControls.matchAll(/<button[^>]*class="([^"]+)"/g)).map((m) => m[1].split(/\s+/).find((c) => /minimize-btn|modal-work-area-maximize|close-btn/.test(c))),
    ['minimize-btn', 'modal-work-area-maximize', 'close-btn'], 'Atelier caption cluster: minimize, maximize, close only');

console.log('test-frame-chrome: ok');
