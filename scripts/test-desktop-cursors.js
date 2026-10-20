#!/usr/bin/env node
// Cursor packs are gone (#588). Tokens stay native keywords. Task monitor is a11y only.
// Run: node scripts/test-desktop-cursors.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

assert.ok(!fs.existsSync(path.join(ROOT, 'public/scripts/comp/desktopCursors.js')));
assert.ok(!fs.existsSync(path.join(ROOT, 'modules/desktopCursorsStatic.js')));
assert.ok(!fs.existsSync(path.join(ROOT, 'public/cursors/vista')));

const css = read('public/css/desktop-cursors.css');
assert.ok(css.includes('--c-pointer: pointer;'));
assert.ok(css.includes('--c-wait: wait;'));
assert.ok(!css.includes('data-cursor-scheme'));
assert.ok(!css.includes('data-task-cursor'));
assert.ok(!css.includes('/cursors/'));
assert.ok(!css.includes('.ani'));

const html = read('public/app.html');
assert.ok(html.includes('href="/css/desktop-cursors.css"'));
assert.ok(!html.includes('data-cursor-scheme'));
assert.ok(!html.includes('desktopSettingsCursorSchemeToggle'));
assert.ok(!html.includes('scripts/comp/desktopCursors.js'));
assert.ok(html.includes('scripts/comp/desktopTaskMonitor.js'));

const modal = read('public/scripts/comp/modalUtils.js');
assert.ok(!modal.includes('setupDesktopSettingsCursorSchemeToggle'));
assert.ok(!modal.includes('desktopCursors.setScheme'));

const cpl = read('public/scripts/comp/melatonControlPanel.js');
assert.ok(!cpl.includes("id: 'mouse'"));
assert.ok(!cpl.includes('Choose the pointer scheme'));

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
assert.ok(!server.includes("app.get('/cursors/:scheme/:file'"));
assert.ok(!server.includes('listCursorPackFiles'));
assert.ok(!server.includes('desktopCursorsStatic'));

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

const taskMonitorSrc = read('public/scripts/comp/desktopTaskMonitor.js');
assert.ok(!taskMonitorSrc.includes('data-task-cursor'));
assert.ok(taskMonitorSrc.includes("setAttribute('aria-busy', 'true')"));

assert.ok(read('public/scripts/websocket.js').includes('desktopTaskMonitor.sync()'));
assert.ok(read('public/scripts/comp/trayIndicators.js').includes('desktopTaskMonitor.sync()'));
assert.ok(read('public/scripts/comp/explorerApplet.js').includes('desktopTaskMonitor.sync()'));
assert.ok(read('public/scripts/comp/director.js').includes('desktopTaskMonitor.sync()'));
assert.ok(read('public/scripts/comp/galleryView.js').includes('desktopTaskMonitor.sync()'));

const KEYWORDS = [
    'auto', 'default', 'none', 'context-menu', 'help', 'pointer', 'progress', 'wait',
    'cell', 'crosshair', 'text', 'vertical-text', 'alias', 'copy', 'move', 'no-drop',
    'not-allowed', 'grab', 'grabbing', 'all-scroll', 'col-resize', 'row-resize',
    'n-resize', 'e-resize', 's-resize', 'w-resize', 'ne-resize', 'nw-resize',
    'se-resize', 'sw-resize', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize',
    'zoom-in', 'zoom-out'
];
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
