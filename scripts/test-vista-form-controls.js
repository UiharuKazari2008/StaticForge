#!/usr/bin/env node
// Vista text boxes everywhere (Yukimi 2026-10-13): the default input / textarea / select look in
// desktop mode is Vista's own (aero.msstyles EDIT / COMBOBOX faces, scripts/build-vista-controls.sh,
// 2026-10-21), except .hover-show (the custom apps' reveal-on-hover controls), Studio, the chrome
// toolbars and the Classic theme; .win7 content takes the faces but keeps its own font.
// Run: node scripts/test-vista-form-controls.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/vista-glass-controls.css'), 'utf8');
const rules = css.split('}').map((r) => r.trim()).filter((r) => /^body\.desktop-mode:not\(\.windows-classic-theme\) (:is\(input|select)/.test(r) || /\*\/\s*body\.desktop-mode:not\(\.windows-classic-theme\) (:is\(input|select)/.test(r));
assert.ok(rules.length >= 9, 'the text box, placeholder, hover, focus, disabled and select rules are there');
for (const r of rules.filter((x) => x.includes('{'))) {
    assert.ok((r.includes(':not(.hover-show)') || r.includes(':not(.hover-show:not(.modal[data-vista-dialog] *))')), `hover-show stays custom: ${r.slice(0, 80)}`);
    assert.ok(r.includes(':not([id="manualModal"] *)') && r.includes(':not(.modal-window-title-toolbar *)'), `Studio and the chrome toolbars keep theirs: ${r.slice(0, 80)}`);
    if (r.includes('font-family')) assert.ok(r.includes(':not(.win7 *)'), `.win7 content keeps its font: ${r.slice(0, 80)}`);
}
const face = (state) => `url("/static_images/vista-controls/${state}.png")`;
const box = rules.find((r) => r.includes(`--vista-edit-face: ${face('edit-normal')}`));
assert.ok(box && box.includes('border-image: var(--vista-edit-face) 2 fill / 2px stretch') && box.includes('background: #fff'), "Vista's text box face, 9-sliced 2 px");
assert.ok(rules.some((r) => r.includes(':hover:not(:disabled)') && r.includes(face('edit-hot'))), 'hover face');
assert.ok(rules.some((r) => r.includes(':focus') && r.includes(face('edit-focus'))), 'focus face');
assert.ok(rules.some((r) => r.includes(':disabled') && r.includes(face('edit-disabled')) && r.includes('#f4f4f4')), 'disabled');
assert.ok(rules.some((r) => r.includes('select:not([multiple])') && r.includes(face('combo-normal')) && r.includes(face('combo-glyph-normal'))), "Vista's drop-down list face and glyph");
for (const f of ['edit-normal', 'edit-hot', 'edit-focus', 'edit-disabled', 'combo-normal', 'combo-normal-fill', 'combo-glyph-normal', 'button-normal', 'button-hot', 'button-pressed', 'button-disabled', 'button-default', 'button-default-pulse']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public/static_images/vista-controls', f + '.png')), `${f}.png is built`);
}
// push buttons: Vista's face for the shared classes in Windows-look clients, not on chrome / orbs
const btn = css.split('}').map((r) => r.trim()).find((r) => r.includes('--vista-button-face: url("/static_images/vista-controls/button-normal.png")'));
assert.ok(btn && btn.includes('button:is(.btn-primary, .btn-secondary, .btn-danger, .btn-warning') && btn.includes('border-image: var(--vista-button-face) 4 fill / 4px / var(--vista-button-outset, 0) stretch'), 'push button face');
assert.ok(btn.includes(':not(.round-button, .close-btn, .custom-dropdown-btn') && btn.includes(":not(.modal-window-title *, .modal-window-title-toolbar *, .modal-window-controls *, [role=\"toolbar\"] *, .explorer-actions-header *, .dovecote-command-bar *"), 'orbs, caption buttons and chrome toolbars keep theirs');
assert.ok(btn.includes('.cpl-wu-button, .tbp-button, :not([class])') && css.includes('.tbp-client button.tbp-button:not(#_) {\n    --vista-button-outset: 1px;'), 'the property sheets and Remote Desktop Connection take the face (73x21 boxes)');
// the default moves with the focus and pulses as the VM's: 16 steps of 63 ms each way
assert.ok(css.includes(':is(:focus, :is(.btn-primary, [data-dialog-primary="1"], .primary):not(.modal:has(button:focus'), 'a focused push button takes the default');
assert.ok(css.includes('animation: vista-button-default-pulse 2.016s infinite;') && css.includes('50% { opacity: 1; animation-timing-function: steps(16, jump-end); }'), 'stepped 2.016 s pulse');
// the open list (base-select): Vista's frame, rows and highlight; no highlight on the closed part while open
assert.ok(css.includes('@supports (appearance: base-select) {') && css.includes('border: 1px solid #646464;') && css.includes('option::checkmark {') && css.includes('line-height: 13px;'), "Vista's drop-down list");
assert.ok(css.includes(':focus:not(:disabled):not(:is(:open)) {\n    --vista-combo-text'), 'the text loses its highlight while the list is open');
// the app's own hover-show rules are untouched
const app = fs.readFileSync(path.join(__dirname, '..', 'public/css/app.css'), 'utf8');
assert.ok(app.includes('.form-control.hover-show,') && app.includes(':not(.hover-show) > .form-control:hover:not(:disabled)'), 'app.css hover-show rules intact');
console.log('test-vista-form-controls: ok');

// the chrome boxes (Cartograph, Control Panel, Grimoire) are Vista's opaque fills, and every other
// window's caption toolbar takes the Vista command-bar look (2026-10-13)
const ve = fs.readFileSync(path.join(__dirname, '..', 'public/css/vista-explorer.css'), 'utf8');
assert.ok(!ve.includes('hsl(0 0% 100% / 70%), hsl(0 0% 100% / 76%) 25%'), 'no translucent box fill is left');
assert.ok(ve.includes('var(--vista-box-fill, linear-gradient(#e3ebf3, #eaf1f8 25%, #eaf1f8 75%, #e7eff6))'), "Explorer's address box fill");
assert.ok(ve.includes('--vista-box-fill: linear-gradient(#ebf2f9, #f2f8fe 25%, #f3f8fd 75%, #eef5fb);'), 'the search / IE fill');
assert.ok(ve.includes('#grimoireAddressBar.wiki-address-bar:is(.edit-active, :focus-within)') && ve.includes('--vista-box-edge: #3d7bad;'), "IE7's focused edge");
assert.ok(ve.includes('.wiki-address-bar.edit-active .address-display-layer {') && ve.includes('padding-left: 28px;'), 'the page icon stays while editing');
assert.ok(!ve.includes("vista-explorer/refresh.png"), 'the refresh cell uses the transparent IE glyph');
assert.ok(ve.includes('.modal:not(#explorerModal, #tagWikiSearchModal, #melatonControlPanelModal, #directorWindow, #desktopMediaPlayer, #desktopMediaPlayerUrl) .modal-window-title-toolbar > .button-group:has(.form-control, input:not([type="hidden"]))'), 'generic toolbar search box');
const tw = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/tagWikiSearchModal.js'), 'utf8');
assert.ok(/enterAddressEdit\(\) \{[\s\S]*?this\.searchInput\.select\(\);/.test(tw), 'a click selects the address on the desktop');
const mn = fs.readFileSync(path.join(__dirname, '..', 'public/css/melaton-network.css'), 'utf8');
assert.ok(/\.cpl-db-page \{[^}]*height: 100%;[^}]*overflow: hidden;/.test(mn) && /\.cpl-db-grid \{[^}]*flex: 1 1 auto;/.test(mn), 'the wallpaper list scrolls inside the page');
// the common base of the three chromed windows (VM measurements) and Vista's address-bar progress
assert.ok(ve.includes(':is(#explorerModal, #melatonControlPanelModal, #tagWikiSearchModal).modal.toolbar-visible:not(.modal-maximized) {\n    --modal-title-chrome-height: 62px;'), 'content at 63 like Vista');
assert.ok(/\.modal-window-title-toolbar \{\s*position: absolute;\s*top: 28px;\s*left: 8px;\s*right: 8px;/.test(ve), 'the orbs at (11,32), the search box 9px from the edge (the title box starts 1px in)');
assert.ok((ve.match(/flex: 0 0 238px;/g) || []).length >= 1, 'the 238px search box');
assert.ok(ve.includes('width: calc(var(--vista-load, var(--alchemy-load, 0%)) - 2px);') && ve.includes('.vista-load-reset::before'), 'the green address-bar progress fades, then resets unseen');
const cplJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/melatonControlPanel.js'), 'utf8');
assert.ok(cplJs.includes('explorer-recent-pages-btn cpl-recent') && cplJs.includes('function recentPagesMenu(') && cplJs.includes("setProperty('--vista-load'"), 'Control Panel: Recent Pages ▾ and the loading fill');
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/explorerApplet.js'), 'utf8').includes('_addressLoad(1)'), 'Cartograph fills the box while a folder loads');
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/grimoireIeChrome.js'), 'utf8').includes("BOOKS_ICON = '/static_images/app_icons/books.webp'"), "the Grimoire's icon is its pages' favicon");
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/modalUtils.js'), 'utf8').includes('Math.round(rect.left)'), 'restored windows land on whole pixels');
console.log('test-vista-form-controls (chrome): ok');
