#!/usr/bin/env node
// Visual Index as a Vista-era owned tool window (Yozora #469): the window is a light client
// (data-window-client="light", vista-glass-controls.css; no .win7: the client has no native controls) and vista-visual-index.css gives
// it Explorer's command bar as its header, Explorer's Large Icons view as its grid (the photo
// frame, the hot and selected boxes, the caption under the thumbnail), Vista's scrollbar, and a
// Close-only caption without an icon. Run: node scripts/test-visual-index-vista.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('public/css/vista-visual-index.css');
const html = read('public/app.html');
const js = read('public/scripts/comp/galleryJumpIndex.js');
const G = 'body.desktop-mode:not(.windows-classic-theme)';

// wiring
assert.ok(html.includes('<link rel="stylesheet" href="/css/vista-sidebar.css">\n    <link rel="stylesheet" href="/css/vista-visual-index.css">'), 'sheet linked after vista-sidebar.css');
const tool = html.slice(html.indexOf('<div id="galleryJumpIndexTool"'), html.indexOf('<div id="galleryJumpIndexGrid"'));
assert.ok(tool.includes('data-window-client="light"'), 'the window is a light client');
assert.ok(tool.includes('data-parent-modal-id="galleryWindow"'), 'the window is owned by the Workspace window');
assert.ok(tool.includes('class="modal-content dark">\n            <div class="modal-body gallery-jump-index-content">'), 'no .win7 on the content: nothing native in it, and .win7 button would restyle the tiles in the plain web app');
assert.ok(tool.includes('class="gallery-jump-index-header"') && tool.includes('id="galleryJumpIndexSummary"'), 'the header with the summary');
assert.ok(tool.includes('id="galleryJumpIndexMinTimeDropdownBtn"') && tool.includes('id="galleryJumpIndexMaxGroupDropdownBtn"'), 'the two pickers');
assert.ok(tool.includes('class="gallery-jump-index-grid-shell" data-custom-scrollbar'), 'the grid shell is a custom-scrollbar host');
assert.ok(js.includes("card.className = 'gallery-jump-index-card'") && js.includes('<div class="gallery-jump-index-card-meta">${entry.groupCount} images</div>'), 'tiles: the image, then the count (the caption sits under the thumbnail in DOM order)');

// the gate: every rule on the Vista desktop only
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = code.split('}').map((s) => s.trim()).filter((s) => s.includes('{')).map((s) => s.slice(0, s.indexOf('{')).trim()).filter((s) => s && !s.startsWith('@'));
assert.ok(rules.length >= 20, 'the sheet has its rules');
for (const selector of rules) {
    for (const part of selector.split(',\n')) {
        assert.ok(part.trim().startsWith(`${G} #galleryJumpIndexTool`), `gated and scoped: ${part.trim()}`);
    }
}
assert.ok(!/[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00d7\u00a0]/.test(css), 'keyboard characters only');

// the light client
assert.ok(css.includes(`${G} #galleryJumpIndexTool > .modal-content {\n    background: #f0f0f0;`) && css.includes('    color: #000;\n    text-shadow: none;'), 'flat #f0f0f0 client, black text, no glow');

// the caption: no icon, Close only
assert.ok(css.includes(`${G} #galleryJumpIndexTool .modal-window-title-main > :is(i:first-child, .icon-fa, .icon-image) {\n    display: none;`), 'no caption icon');
assert.ok(css.includes(`${G} #galleryJumpIndexTool .modal-window-controls > .minimize-btn {\n    display: none;`), 'no Minimize on the desktop');
assert.ok(css.includes(`${G} #galleryJumpIndexTool .modal-window-controls > .close-btn {\n    border-bottom-left-radius: 5px;`), 'the lone Close keeps the cluster corner');

// the header: Explorer's command bar (the band vista-explorer.css draws), the pickers as its buttons
const explorer = read('public/css/vista-explorer.css');
const band = 'background: linear-gradient(#b6d2d9, #85b3bf 8%, #488d9f 49%, #156477 50%, #1c677a 62%, #4b94a1 92%, #99c9cf 97%, #99c9cf);\n    border-top: 1px solid #777e85;\n    border-bottom: 1px solid #0b3742;';
assert.ok(explorer.includes(band), "Explorer's command bar is still the source of the band");
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-header {\n    gap: 0;\n    min-height: 32px;\n    padding: 0 4px;\n    ${band}`), 'the header is the 32px command bar');
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-summary {`) && css.includes('    color: #fff;\n    font: 12px/15px "Segoe UI", "SegoeUI", "Noto Sans", sans-serif;\n    text-shadow: 0 0 6px hsl(200 80% 10% / 90%), 0 1px 1px hsl(200 80% 10% / 70%);'), "the summary is the bar's white text");
const hot = 'background: linear-gradient(#afc7d6, #537c98 48%, #0e364f 50%, #2f668a);\n    border-color: #044875;\n    box-shadow: inset 0 1px 0 #d8e4ec, inset 0 -1px 0 #92b1c4;';
assert.ok(explorer.includes(hot), "Explorer's hot command button is still the source");
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-controls .custom-dropdown-btn {`) && css.includes('    height: 24px;\n    min-height: 24px;\n    margin: 0 2px;\n    padding: 0 6px;\n    background: none;\n    border: 1px solid transparent;\n    border-radius: 3px;'), 'pickers: flat 24px command buttons');
assert.ok(css.includes('.custom-dropdown-btn::after {\n    content: "";') && css.includes("viewBox='0 0 7 4'"), 'pickers: the 7x4 drop-down arrow');
assert.ok(css.includes(`.custom-dropdown-btn:is(:hover, .active, .context-open, [aria-expanded="true"]):not(:disabled) {\n    ${hot}`), 'pickers: hot is the glossy box, an open picker stays hot');
assert.ok(css.includes('.custom-dropdown-btn::before {\n    content: none;') && css.includes('    animation: none;'), "7.css's pseudo-layers and focus pulse are off");

// the grid: Explorer's Large Icons view
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-card {\n    display: block;\n    min-width: 0;\n    min-height: auto;\n    margin: 0;\n    padding: 5px 5px 3px;\n    overflow: visible;`), 'tiles: a content-sized cell (the auto rows of a definite-height scroller take the minimum contribution: min-height auto and no scroll container)');
assert.ok(css.includes('    overflow: visible;\n    background: none;\n    border: 1px solid transparent;\n    border-radius: 3px;'), 'tiles: a transparent cell with the 3px-rounded box');
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-card::before,\n${G} #galleryJumpIndexTool .gallery-jump-index-card::after {\n    content: none;`), "tiles: 7.css's pseudo-layers are off");
assert.ok(css.includes('.gallery-jump-index-card:hover {\n        background: linear-gradient(#fafbfd, #ebf3fd);\n        border-color: #b8d6fb;'), "tiles: Explorer's hot box");
assert.ok(explorer.includes('background: linear-gradient(#fafbfd, #ebf3fd);\n        border-color: #b8d6fb;'), "Explorer's hot item is still the source");
assert.ok(css.includes('.gallery-jump-index-card.active-boundary:hover {\n    background: linear-gradient(#f6fbfd, #eff8fd 45%, #d7effc 55%, #d5effc 92%, #e7f5fd);\n    border-color: #99defd;'), "tiles: Vista's selection on the current boundary");
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-card img {\n    box-sizing: border-box;\n    width: 100%;\n    margin: 0;\n    background: #fff;\n    border: 3px solid #fff;\n    border-radius: 0;\n    box-shadow: 0 0 0 1px #b9b9b9, 1px 1px 3px #0005;`), 'the white photo frame with its grey line and shadow');
assert.ok(explorer.includes('border: 3px solid #fff;') && explorer.includes('box-shadow: 0 0 0 1px #b9b9b9, 1px 1px 3px #0005;'), "the frame is Explorer's photo-frame recipe");
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-card-meta {\n    position: static;\n    display: block;`) && css.includes('    color: #000;\n    font: 12px/15px "Segoe UI", "SegoeUI", "Noto Sans", sans-serif;\n    text-shadow: none;\n    white-space: nowrap;'), 'the count is a black 9pt caption under the thumbnail');

// the scrollbar: the grid is the scroller so vista-scrollbars.css draws its bar; the overlay hides
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-grid-scrollable {\n    overflow-y: hidden;`), 'the overlay wrapper never scrolls');
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-grid-shell > .custom-scrollbar {\n    display: none;`), 'the overlay scrollbar is hidden');
assert.ok(css.includes(`${G} #galleryJumpIndexTool .gallery-jump-index-grid {\n    flex: 1 1 auto;\n    min-height: 0;\n    overflow-x: hidden;\n    overflow-y: auto;`), 'the grid scrolls');
const scrollbars = read('public/css/vista-scrollbars.css');
assert.ok(scrollbars.includes(`${G} :not(html):not(.has-custom-scrollbar):not(.scrollable-content):not(.form-section-scroll):not(.modal-window-title-toolbar)::-webkit-scrollbar {\n    width: 17px;`), 'the Vista bar applies to any desktop scroller that is not the overlay wrapper (the grid)');
assert.ok(!/filter:(?!\s*none)/.test(code) && !code.includes('will-change'), 'no filters (only the client resets them to none)');
console.log('test-visual-index-vista: ok');
