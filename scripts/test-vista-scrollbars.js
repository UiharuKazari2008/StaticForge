#!/usr/bin/env node
// Vista scrollbars 1:1 (Yozora #467): the generated sheet is current, paints every part from
// Vista's own aero.msstyles bitmaps (not 7.css's Windows 7 gradients), keeps the desktop-only
// gate and the custom-scrollbar exclusions, and the art it references exists with the sizes the
// VM measurement fixed (17 px bars, 17x17 buttons, 13x13 glyphs, 17x20 / 18x17 thumbs, 9x10 /
// 10x9 grippers, 1 px track profiles). Run: node scripts/test-vista-scrollbars.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/css/vista-scrollbars.css');
const ART = path.join(ROOT, 'public/static_images/vista-scrollbar');

execFileSync(process.execPath, [path.join(__dirname, 'build-vista-scrollbars.js'), '--check'], { stdio: 'pipe' });
const css = fs.readFileSync(OUT, 'utf8');
const SCOPE = 'body.desktop-mode:not(.windows-classic-theme) :not(html):not(.has-custom-scrollbar):not(.scrollable-content):not(.form-section-scroll):not(.modal-window-title-toolbar)';

assert.ok(!css.includes('--w7-') && !css.includes('7.css'), 'no 7.css gradients or variables are left');
assert.ok(css.includes(`${SCOPE}::-webkit-scrollbar {\n    width: 17px;`), '17 px bar, desktop-only gate with the custom-scrollbar exclusions');
assert.ok(css.includes(`${SCOPE}::-webkit-scrollbar:horizontal {\n    height: 17px;`), '17 px horizontal bar');
assert.ok(css.includes('::-webkit-scrollbar-corner {\n    background: #f0f0f0;'), "Vista's flat corner");
for (const dir of ['up', 'down', 'left', 'right']) {
    for (const state of ['normal', 'hot', 'pressed', 'disabled']) {
        assert.ok(css.includes(`glyph-${dir}-${state}.png"), url("/static_images/vista-scrollbar/arrow-${dir}-${state}.png")`), `${dir} ${state} button: glyph over face`);
    }
}
assert.ok(css.includes(':vertical:start:hover {') && css.includes(':vertical:start:active {') && css.includes(':vertical:start:disabled {'), 'state pseudo-classes after the position ones (Chrome matched :disabled only that way)');
assert.ok(css.includes("background-position: center top 1px, center"), "the up glyph sits one row higher, as Vista draws it");
assert.ok(css.includes('::-webkit-scrollbar-button:vertical:start:increment,') && css.includes('display: none'), 'one button at each end');
for (const o of ['v', 'h']) {
    for (const state of ['normal', 'hot', 'pressed']) {
        assert.ok(css.includes(`thumb-${o}-${state}.png")`) && css.includes(`gripper-${o}-${state}.png"), url("/static_images/vista-scrollbar/thumb-${o}-${state}-mid.png")`), `${o} thumb ${state}: caps, gripper and middle strip`);
    }
}
assert.ok(css.includes('::-webkit-scrollbar-thumb:vertical {\n    border-width: 4px 0;\n    border-image-slice: 4 0;'), 'vertical thumb caps are 4 px');
assert.ok(css.includes('::-webkit-scrollbar-thumb:horizontal {\n    border-width: 0 5px 0 4px;\n    border-image-slice: 0 5 0 4;'), 'horizontal thumb caps are 4 / 5 px');
assert.ok(css.includes('::-webkit-scrollbar-thumb:disabled {\n    border-image: none;\n    background: none;'), 'no thumb on a bar with nothing to scroll');
assert.ok(css.includes('scrollbar-width: auto;') && css.includes('.explorer-grid-scroll'), 'the thin-bar resets survive');
// Vista applications on the overlay scrollbar (Periscope) show the native bar instead on the desktop
const NATIVE = 'body.desktop-mode:not(.windows-classic-theme) #logViewerModal .scrollable-content';
// the hosts share one rule (a selector list), so match the host's line inside it
const hidesOverlay = (host) => new RegExp('body\\.desktop-mode:not\\(\\.windows-classic-theme\\) ' + host + ' \\.has-custom-scrollbar > \\.custom-scrollbar[^{]*\\{\\n    display: none;').test(css);
assert.ok(hidesOverlay('#logViewerModal'), "Periscope's overlay bar is hidden");
// Reference Manager and Dovecote take the native Vista bar too (#474 / #473)
assert.ok(hidesOverlay('#cacheManagerModal'), "Reference Manager's overlay bar is hidden");
assert.ok(css.includes('body.desktop-mode:not(.windows-classic-theme) #cacheManagerModal .scrollable-content::-webkit-scrollbar-thumb'), 'Reference Manager scroller gets the Vista thumb');
assert.ok(css.includes('body.desktop-mode:not(.windows-classic-theme) #desktopDovecoteModal .scrollable-content::-webkit-scrollbar-thumb'), "Dovecote's message list gets the Vista thumb");
assert.ok(!css.split('\n').some((line) => line.includes('::-webkit-scrollbar') && line.includes(':is(')), 'no :is() in a scrollbar part selector: Chrome drops those rules');
// a rule whose selector list holds `selector` (other hosts may follow it) and whose body starts with `body`
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ruleHas = (selector, body) => new RegExp(escapeRe(selector) + '(,\\n[^{]*)? \\{\\n' + escapeRe(body)).test(css);
assert.ok(ruleHas(NATIVE, '    scrollbar-width: auto;\n    scrollbar-color: auto;') && ruleHas(`${NATIVE}::-webkit-scrollbar`, '    display: block;'), "Periscope's inner scroller shows its native bar again");
assert.ok(ruleHas(`${NATIVE}::-webkit-scrollbar`, '    width: 17px;') && css.includes(`${NATIVE}::-webkit-scrollbar-thumb:vertical:hover`), 'and takes the Vista parts');

const sizes = {
    'arrow-up-normal.png': '17x17', 'arrow-right-hover.png': '17x17', 'glyph-down-pressed.png': '13x13', 'glyph-left-disabled.png': '13x13',
    'thumb-v-normal.png': '17x20', 'thumb-h-hot.png': '18x17', 'thumb-v-pressed-mid.png': '17x1', 'thumb-h-normal-mid.png': '1x17',
    'gripper-v-normal.png': '9x10', 'gripper-h-hover.png': '10x9', 'track-v.png': '17x1', 'track-h.png': '1x17'
};
for (const [file, size] of Object.entries(sizes)) {
    const p = path.join(ART, file);
    assert.ok(fs.existsSync(p), `${file} exists`);
    const buf = fs.readFileSync(p);
    assert.strictEqual(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, size, `${file} is ${size}`);
}
for (const m of css.matchAll(/url\("\/static_images\/vista-scrollbar\/([^"]+)"\)/g)) {
    assert.ok(fs.existsSync(path.join(ART, m[1])), `referenced art exists: ${m[1]}`);
}
console.log('test-vista-scrollbars: ok');
