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
    'vista-folder', 'vista-defender', 'vista-favorites',
    // round two (Yukimi's picks 2026-10-13): Journal, Live Messenger (oobefldr.dll), Photo Gallery
    // Viewer, User Accounts (usercpl.dll), Easy Transfer, Snipping Tool, WordPad's document, and
    // the split Global Settings items (imageres -80 taskbar, main.cpl mouse / keyboard, mmsys.cpl)
    'vista-journal', 'vista-messenger', 'vista-photo-viewer', 'vista-user-accounts', 'vista-easy-transfer',
    'vista-snipping-tool', 'vista-wordpad-document', 'vista-appearance', 'vista-mouse', 'vista-keyboard',
    'vista-sound', 'vista-taskbar', 'vista-performance'
];
// generated with scripts/generate-app-icon.js in the Vista language (1024px masters)
for (const name of ['vista-teleport', 'vista-weather', 'vista-mask-editor', 'vista-expand-canvas', 'vista-phasewalker']) {
    const buf = fs.readFileSync(path.join(ROOT, ICONS, `${name}.png`));
    assert.strictEqual(buf.readUInt32BE(16), 1024, `${name}.png is a generated master`);
}
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
launch('event-viewer', 'vista-performance'); // Periscope: Performance Information and Tools (PerfCenterCPL.dll)
assert.match(modalUtils, /id: 'help', text: 'Help and Support', imageIcon: 'vista-help\.png'/);
assert.match(modalUtils, /id: 'control-panel', text: 'Control Panel', imageIcon: 'vista-control-panel\.png'/);
assert.match(modalUtils, /text: 'Toolbox', imageIcon: 'vista-folder\.png'|imageIcon: 'vista-folder\.png', text: 'Toolbox'/);
launch('notebook', 'vista-journal');
launch('chat', 'vista-messenger');
launch('planet-switcher', 'vista-teleport');
launch('import', 'vista-easy-transfer');
launch('bracket-generation', 'vista-phasewalker');
launch('alarm', 'vista-date-time');
assert.match(modalUtils, /launchId: 'alarm'[^\n]*text: 'Alarm Clock'/, 'Alarm and Pomodoro are one app');
assert.match(modalUtils, /launchId: 'pomodoro'[^\n]*startMenu: false, appMenu: false/, 'the Pomodoro launcher is kept for old shortcuts only');
assert.match(modalUtils, /id: 'workspaces', text: 'Workspaces', imageIcon: 'planet\.png'/, 'Workspaces keeps the planet');
// the custom apps keep theirs
launch('director', 'director');
launch('naxt', 'test_tube');

const cpl = read('public/scripts/comp/melatonControlPanel.js');
for (const icon of ['vista-personalization', 'vista-remote-desktop', 'vista-system', 'vista-regedit', 'vista-control-panel',
    'vista-appearance', 'vista-mouse', 'vista-sound', 'vista-taskbar', 'vista-keyboard']) {
    assert.ok(cpl.includes(`/static_images/app_icons/${icon}.webp`), `Control Panel uses ${icon}`);
}

const app = read('public/app.html');
const windowIcon = (id, icon) => {
    const at = app.indexOf(`id="${id}"`);
    assert.ok(at > 0, `${id} in app.html`);
    assert.ok(app.slice(at, at + 4000).includes(`app_icons/${icon}.webp`), `${id} titlebar -> ${icon}`);
};
windowIcon('explorerModal', 'vista-explorer');
windowIcon('galleryWindow', 'art');
assert.match(modalUtils, /launchId: 'workspace',\s*icon: 'fas fa-film-canister',\s*imageIcon: 'art\.png'/, 'Workspace keeps its own icon');
windowIcon('logViewerModal', 'vista-performance');
windowIcon('dreamscapeAppErrorModal', 'vista-event-viewer'); // Spectator
windowIcon('tokenDisplayModal', 'vista-calculator');
windowIcon('tagWikiSearchModal', 'vista-iexplore');
windowIcon('configEditorModal', 'vista-regedit');
windowIcon('desktopSettingsModal', 'vista-personalization');
windowIcon('notebookModal', 'vista-journal');
windowIcon('personaSettingsModal', 'vista-user-accounts');
windowIcon('imageViewerModalTemplate', 'vista-photo-viewer');
windowIcon('tagWikiWindowTemplate', 'vista-wordpad-document');
windowIcon('imageBiasAdjustmentModal', 'vista-snipping-tool');
windowIcon('maskEditorDialog', 'vista-mask-editor');
windowIcon('imageExpansionDialog', 'vista-expand-canvas');
windowIcon('weatherLocationModal', 'vista-weather');
windowIcon('bracketGenerationModal', 'vista-phasewalker');
assert.ok(!app.includes('app_icons/event_viewer.png'), 'Novel Generation and Studio Activity use Event Viewer too');
assert.ok(app.includes('id="aboutMelatoninModal"'), 'about window');

// Alarm Clock: one window, two tabs
const timer = read('public/scripts/comp/desktop-apps/alarmPomodoro.js');
assert.ok(timer.includes("id: 'desktopTimerModal'") && timer.includes("title: 'Alarm Clock'"), 'one window');
assert.ok(/desktopTimerSelect\('pomodoro'\)/.test(timer) && /desktopTimerSelect\('alarm'\)/.test(timer), 'openDesktopAlarm / openDesktopPomodoro pick their tab');
assert.ok(!timer.includes('desktopAlarmModal') && !timer.includes('desktopPomodoroModal'), 'the old windows are gone');
assert.ok(timer.includes('app_icons/vista-date-time.webp'), 'Date and Time icon');

// desktop shortcuts: Vista's folder / Recycle Bin / file / Internet shortcut by data-vista-icon
const shortcuts = read('public/scripts/comp/desktopShortcuts.js');
for (const kind of ['folder', 'recycle', 'file', 'internet-shortcut', 'document', 'note']) {
    assert.ok(shortcuts.includes(`'${kind}'`), `desktopShortcuts tags ${kind}`);
}
assert.ok(shortcuts.includes("chip.className = 'desktop-note-color-chip'") && shortcuts.includes("setProperty('--note-color', noteColor)"), 'notes carry their colour as a chip');
assert.ok(read('public/scripts/comp/explorerApplet.js').includes("icon.dataset.vistaIcon = 'note'"), 'Cartograph draws notes the same way');
const css = read('public/css/vista-explorer.css');
assert.ok(css.includes('.desktop-shortcut-icon[data-vista-icon="note"] > i') && css.includes('.desktop-note-color-chip'), 'note glyph on the page + chip');
assert.ok(css.includes('> i.fa-image.desktop-shortcut-image-icon {\n    display: none;'), 'pictures lose the type badge (Vista frames them)');
assert.ok(shortcuts.includes('function desktopShortcutPhotoFrame(preview)') && (shortcuts.match(/desktopShortcutPhotoFrame\(imagePreview\)/g) || []).length === 3, 'pictures, references and nax tags get the <img> for the aspect frame');
assert.ok(css.includes('.desktop-shortcut-image-preview > .desktop-shortcut-photo') && css.includes('max-width: var(--photo-box)'), 'the frame hugs the picture');
assert.ok(css.includes('[data-shortcut-type="dsap"]) .desktop-shortcut-icon::after') && css.includes('shortcut-arrow-16.png'), 'app shortcuts carry the 16px arrow on the 48px desktop');
assert.ok(css.includes('folder-48.png') && css.includes('background: no-repeat center / 48px 48px'), 'desktop folders are the 48px frame');
assert.ok(shortcuts.includes("resolveAppIconPath('vista-phasewalker-file.png')") && !shortcuts.includes("resolveAppIconPath('stack.png')"), 'phasewalker states use the file icon');
assert.ok(shortcuts.includes("resolveAppIconPath('vista-code-file.png')"), 'change json uses the code file icon');
assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/app_icons/vista-phasewalker-file.png')) && fs.existsSync(path.join(ROOT, 'public/static_images/app_icons/vista-code-file.png')), 'the two document icons exist');
for (const size of [16, 24, 32, 48]) assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-icons/explorer/shortcut-arrow-${size}.png`)), `arrow ${size}`);
for (const kind of ['folder', 'recycle', 'file', 'internet-shortcut', 'document']) {
    assert.ok(css.includes(`.desktop-shortcut-icon[data-vista-icon="${kind}"]`), `CSS draws ${kind}`);
    for (const size of [64, 256]) {
        assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-icons/explorer/${kind}-${size}.png`)), `${kind}-${size}.png`);
    }
}

console.log('test-vista-app-icons: ok');
