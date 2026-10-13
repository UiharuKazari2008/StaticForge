#!/usr/bin/env node
/**
 * Vista app and file icons (Yukimi 2026-10-13: "update applications and file / shortcut icons to
 * use vista icons ... only replace ones that have a logical replacement"). The vista-*.png masters
 * in public/static_images/app_icons are the VM's own (Start menu shortcut / CLSID DefaultIcon
 * sources); the app keeps its old masters for the apps that stay custom.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ICONS = 'public/static_images/app_icons';

const VISTA = [
    'vista-explorer', 'vista-control-panel', 'vista-run', 'vista-event-viewer', 'vista-remote-desktop',
    'vista-system', 'vista-personalization', 'vista-regedit', 'vista-photo-gallery', 'vista-mail',
    'vista-help', 'vista-iexplore', 'vista-calculator', 'vista-date-time', 'vista-key', 'vista-info',
    'vista-folder', 'vista-defender', 'vista-favorites'
];
for (const name of VISTA) {
    const file = path.join(ROOT, ICONS, `${name}.png`);
    assert.ok(fs.existsSync(file), `${name}.png exists`);
    const buf = fs.readFileSync(file);
    assert.strictEqual(buf.readUInt32BE(16), 256, `${name}.png is the 256px frame`);
}

const modalUtils = read('public/scripts/comp/modalUtils.js');
const launch = (id, icon) => assert.match(modalUtils, new RegExp(`launchId: '${id}'[^\\n]*imageIcon: '${icon}\\.png'`), `${id} -> ${icon}`);
launch('explorer', 'vista-explorer');
launch('encyclopedia', 'vista-iexplore');
launch('remote-desktop', 'vista-remote-desktop');
launch('dovecote', 'vista-mail');
launch('run', 'vista-run');
launch('config-editor', 'vista-regedit');
launch('event-viewer', 'vista-event-viewer');
assert.match(modalUtils, /id: 'help', text: 'Help and Support', imageIcon: 'vista-help\.png'/);
assert.match(modalUtils, /id: 'control-panel', text: 'Control Panel', imageIcon: 'vista-control-panel\.png'/);
assert.match(modalUtils, /text: 'Toolbox', imageIcon: 'vista-folder\.png'|imageIcon: 'vista-folder\.png', text: 'Toolbox'/);
// the custom apps keep theirs
launch('director', 'director');
launch('naxt', 'test_tube');

const cpl = read('public/scripts/comp/melatonControlPanel.js');
for (const icon of ['vista-personalization', 'vista-remote-desktop', 'vista-system', 'vista-regedit', 'vista-control-panel']) {
    assert.ok(cpl.includes(`/static_images/app_icons/${icon}.png`), `Control Panel uses ${icon}`);
}

const app = read('public/app.html');
const windowIcon = (id, icon) => {
    const at = app.indexOf(`id="${id}"`);
    assert.ok(at > 0, `${id} in app.html`);
    assert.ok(app.slice(at, at + 4000).includes(`app_icons/${icon}.png`), `${id} titlebar -> ${icon}`);
};
windowIcon('explorerModal', 'vista-explorer');
windowIcon('logViewerModal', 'vista-event-viewer');
windowIcon('tokenDisplayModal', 'vista-calculator');
windowIcon('tagWikiSearchModal', 'vista-iexplore');
windowIcon('configEditorModal', 'vista-regedit');
windowIcon('desktopSettingsModal', 'vista-personalization');

// desktop shortcuts: Vista's folder / Recycle Bin / file / Internet shortcut by data-vista-icon
const shortcuts = read('public/scripts/comp/desktopShortcuts.js');
for (const kind of ['folder', 'recycle', 'file', 'internet-shortcut']) {
    assert.ok(shortcuts.includes(`'${kind}'`), `desktopShortcuts tags ${kind}`);
}
const css = read('public/css/vista-explorer.css');
for (const kind of ['folder', 'recycle', 'file', 'internet-shortcut']) {
    assert.ok(css.includes(`.desktop-shortcut-icon[data-vista-icon="${kind}"]`), `CSS draws ${kind}`);
    for (const size of [64, 256]) {
        assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-icons/explorer/${kind}-${size}.png`)), `${kind}-${size}.png`);
    }
}

console.log('test-vista-app-icons: ok');
