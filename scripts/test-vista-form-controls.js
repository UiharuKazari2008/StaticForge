#!/usr/bin/env node
// Vista text boxes everywhere (Yukimi 2026-10-13): the default input / textarea / select look in
// desktop mode is 7.css's, except .hover-show (the custom apps' reveal-on-hover controls), Studio,
// .win7 content and the Classic theme. Run: node scripts/test-vista-form-controls.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/vista-glass-controls.css'), 'utf8');
const rules = css.split('}').map((r) => r.trim()).filter((r) => r.includes('Vista text boxes everywhere') || /^body\.desktop-mode:not\(\.windows-classic-theme\) (:is\(input|select)/.test(r));
assert.ok(rules.length >= 9, 'the text box, placeholder, hover, focus, disabled and select rules are there');
for (const r of rules.filter((x) => x.includes('{'))) {
    assert.ok(r.includes(':not(.hover-show)'), `hover-show stays custom: ${r.slice(0, 80)}`);
    assert.ok(r.includes(':not(.win7 *)') && r.includes(':not([id="manualModal"] *)') && r.includes(':not(.modal-window-title-toolbar *)'), `7.css content, Studio and the chrome toolbars keep theirs: ${r.slice(0, 80)}`);
}
const box = rules.find((r) => r.includes('border-color: #abadb3 #dbdfe6 #e3e9ef #e2e3ea'));
assert.ok(box && box.includes('background: #fff') && box.includes('border-radius: 2px'), "7.css's text box edge and fill");
assert.ok(rules.some((r) => r.includes(':hover:not(:disabled)') && r.includes('#5794bf')), 'hover edge');
assert.ok(rules.some((r) => r.includes(':focus') && r.includes('#3d7bad')), 'focus edge');
assert.ok(rules.some((r) => r.includes(':disabled') && r.includes('#838383')), 'disabled');
assert.ok(rules.some((r) => r.startsWith('body.desktop-mode:not(.windows-classic-theme) select:not([multiple])') && r.includes('data:image/svg+xml')), "7.css's select arrow");
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
assert.ok(/\.modal-window-title-toolbar \{\s*position: absolute;\s*top: 29px;\s*left: 10px;\s*right: 8px;/.test(ve), 'the orbs at (11,32), the search box 9px from the edge (the title box starts 1px in)');
assert.ok((ve.match(/flex: 0 0 238px;/g) || []).length >= 1, 'the 238px search box');
assert.ok(ve.includes('var(--vista-load, var(--alchemy-load, 0%)) 100%'), 'the green address-bar progress');
const cplJs = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/melatonControlPanel.js'), 'utf8');
assert.ok(cplJs.includes('explorer-recent-pages-btn cpl-recent') && cplJs.includes('function recentPagesMenu(') && cplJs.includes("setProperty('--vista-load'"), 'Control Panel: Recent Pages ▾ and the loading fill');
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/explorerApplet.js'), 'utf8').includes('_addressLoad(1)'), 'Cartograph fills the box while a folder loads');
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/grimoireIeChrome.js'), 'utf8').includes("BOOKS_ICON = '/static_images/app_icons/books.png'"), "the Grimoire's icon is its pages' favicon");
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/modalUtils.js'), 'utf8').includes('Math.round(rect.left)'), 'restored windows land on whole pixels');
console.log('test-vista-form-controls (chrome): ok');
