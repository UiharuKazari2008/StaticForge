#!/usr/bin/env node
// Pointer scheme tokens, Control Panel / Personalize wiring, no leftover keyword cursors.
// Run: node scripts/test-desktop-cursors.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cursors = require('../public/scripts/comp/desktopCursors.js');
const staticServe = require('../modules/desktopCursorsStatic.js');

assert.strictEqual(cursors.DEFAULT_SCHEME, 'vista');
assert.strictEqual(cursors.normalizeScheme('Posy'), 'posy');
assert.strictEqual(cursors.normalizeScheme('classic'), 'classic');
assert.strictEqual(cursors.normalizeScheme('nope'), null);
assert.ok(cursors.SCHEMES.vista && cursors.SCHEMES.classic && cursors.SCHEMES.posy);

assert.ok(staticServe.KEYWORDS.includes('pointer'));
assert.ok(staticServe.schemeValue('vista', 'pointer').includes('/cursors/vista/aero_link.cur'));
assert.ok(!staticServe.schemeValue('vista', 'pointer').includes('data:image/png'), 'real pack, no drawn PNG');
assert.ok(staticServe.schemeValue('vista', 'text').includes('/cursors/vista/beam_r.cur'));
assert.ok(staticServe.schemeValue('vista', 'crosshair').includes('/cursors/vista/cross.cur'));
assert.strictEqual(staticServe.schemeValue('posy', 'pointer'), 'pointer', 'empty Posy pack is keyword only');
assert.ok(staticServe.schemeValue('vista', 'pointer') !== staticServe.schemeValue('posy', 'pointer'));
assert.strictEqual(staticServe.schemeValue('vista', 'none'), 'none');
assert.strictEqual(staticServe.decodeScheme('classic'), null);
assert.strictEqual(staticServe.decodeScheme('vista'), 'vista');
assert.ok(staticServe.decodeCursorName('aero_arrow.cur'));
assert.strictEqual(staticServe.decodeCursorName('../x.cur'), null);
assert.strictEqual(staticServe.decodeCursorName('evil.exe'), null);
assert.ok(!staticServe.resolveCursorPath(ROOT, 'vista', '../aero_arrow.cur'));

const css = read('public/css/desktop-cursors.css');
assert.ok(css.includes('--c-pointer: pointer;'));
assert.ok(css.includes('html[data-cursor-scheme="vista"]'));
assert.ok(css.includes('html[data-cursor-scheme="posy"]'));
assert.ok(css.startsWith(staticServe.buildCss().trim()));
assert.ok(css.includes('data-task-cursor="progress"'));
assert.ok(css.includes('aria-busy="true"'));
assert.ok(css.includes('var(--c-wait)'));

const html = read('public/app.html');
assert.ok(html.includes('id="desktopSettingsCursorSchemeToggle"'));
assert.ok(html.includes('data-cursor-scheme="vista"'));
assert.ok(html.includes('data-cursor-scheme="classic"'));
assert.ok(html.includes('data-cursor-scheme="posy"'));
assert.ok(html.includes('href="/css/desktop-cursors.css"'));
assert.ok(html.includes('scripts/comp/desktopCursors.js'));
assert.ok(html.includes('scripts/comp/desktopTaskMonitor.js'));

const modal = read('public/scripts/comp/modalUtils.js');
assert.ok(modal.includes('setupDesktopSettingsCursorSchemeToggle'));
assert.ok(modal.includes('desktopCursors.setScheme'));

const cpl = read('public/scripts/comp/melatonControlPanel.js');
assert.ok(cpl.includes("id: 'mouse'"));
assert.ok(cpl.includes('Choose the pointer scheme'));

const popover = read('public/scripts/comp/popoverManager.js');
assert.ok(!popover.includes('playBalloon'), 'tray popovers must not play Balloon');
const toast = read('public/scripts/comp/toastManager.js');
assert.ok(!toast.includes('playBalloon'), 'glass toasts must not play Balloon');

const registry = read('public/scripts/comp/modalKeyboardRegistry.js');
assert.ok(registry.includes('function scheduleDeadKeySound'));
assert.ok(!/scheduleDeadKeySound\(event\)/.test(registry), 'dead-key Ding stays off');
assert.ok(!registry.includes("desktopSounds.play('dialog')"));

const shortcuts = read('public/scripts/comp/keyboardShortcuts.js');
assert.ok(/if \(event\.defaultPrevented\) \{[\s\S]*return true;/.test(shortcuts));

const server = read('web_server.js');
assert.ok(server.includes("app.get('/cursors/:scheme/:file'"));
assert.ok(server.includes("itemRel === 'cursors'"));
assert.ok(server.includes('listCursorPackFiles'));
const pack = staticServe.listCursorPackFiles(ROOT).map((entry) => entry.webPath);
assert.ok(pack.includes('/cursors/vista/aero_arrow.cur'));
assert.ok(pack.includes('/cursors/vista/aero_link.cur'));
assert.ok(pack.includes('/cursors/vista/beam_r.cur'));
assert.ok(pack.includes('/cursors/vista/aero_busy.ani'));
assert.ok(pack.every((url) => url.startsWith('/cursors/vista/') || url.startsWith('/cursors/posy/')));
assert.ok(!pack.some((url) => url.includes('..')));

const monitor = require('../public/scripts/comp/desktopTaskMonitor.js');
assert.strictEqual(monitor.WINDOW_FOR_TYPE.generate_image, 'manualModal');
assert.strictEqual(monitor.WINDOW_FOR_TYPE.request_gallery, 'galleryWindow');
assert.strictEqual(monitor.WINDOW_FOR_TYPE.director_send_message, 'directorWindow');
assert.strictEqual(monitor.isProgressType('ping'), false);
assert.strictEqual(monitor.isProgressType('generate_image'), true);
assert.strictEqual(monitor.isProgressType('enhance_image'), true);
const classified = monitor.classifyPending([
    { type: 'ping' },
    { type: 'search_tags' },
    { type: 'generate_image' },
    { type: 'request_gallery' },
    { type: 'workspace_update_window_positions', silentTicker: true }
]);
assert.ok(classified.windows.manualModal);
assert.ok(classified.windows.galleryWindow);
assert.ok(classified.background.generate_image);
assert.ok(!classified.windows.directorWindow);
const idle = monitor.classifyPending([]);
assert.deepStrictEqual(Object.keys(idle.windows), []);
assert.deepStrictEqual(Object.keys(idle.background), []);

assert.ok(read('public/scripts/websocket.js').includes('desktopTaskMonitor.sync()'));
assert.ok(read('public/scripts/comp/trayIndicators.js').includes('desktopTaskMonitor.sync()'));
assert.ok(read('public/scripts/comp/explorerApplet.js').includes('desktopTaskMonitor.sync()'));
assert.ok(read('public/scripts/comp/director.js').includes('desktopTaskMonitor.sync()'));
assert.ok(read('public/scripts/comp/galleryView.js').includes('desktopTaskMonitor.sync()'));

const KEYWORDS = staticServe.KEYWORDS;
const BARE = new RegExp(
    `cursor\\s*:\\s*(?:${KEYWORDS.map((k) => k.replace(/-/g, '\\-')).join('|')})\\b`,
    'i'
);
const SKIP = new Set([
    path.join(ROOT, 'public/css/desktop-cursors.css')
]);

function walk(dir, files) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'photoswipe') return;
            walk(full, files);
            return;
        }
        if (!/\.(css|js|html)$/.test(ent.name)) return;
        if (SKIP.has(full)) return;
        files.push(full);
    });
}

const leftovers = [];
const files = [];
walk(path.join(ROOT, 'public'), files);
files.forEach((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        if (line.includes('Story cursor:')) return;
        if (line.includes('--c-auto:') || line.includes('--c-default:') || line.includes('--c-progress:') || line.includes('--c-wait:')) return;
        if (BARE.test(line) && !line.includes('var(--c-')) {
            leftovers.push(`${path.relative(ROOT, file)}:${i + 1}:${line.trim()}`);
        }
    });
});
assert.deepStrictEqual(leftovers, [], leftovers.join('\n'));

console.log('test-desktop-cursors: ok');
