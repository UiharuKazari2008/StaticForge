#!/usr/bin/env node
// Personalization (Yukimi 2026-10-21): per-workspace window colour / intensity / transparency, sound
// events and the screen saver (desktopPersonalization.js, screenSaver.js, personalizationDialogs.js,
// cplPersonalization.js), and the server field that stores it (modules/workspace.js).
// Run: node scripts/test-desktop-personalization.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const P = require('../public/scripts/comp/desktopPersonalization.js');
const { normalize, cssFor } = P._test;

// defaults: Clear glass, Vista's intensity range, no screen saver
const d = normalize({});
assert.strictEqual(d.windowColor, 'clear');
assert.strictEqual(d.intensity, 30);
assert.strictEqual(d.transparency, true);
assert.deepStrictEqual({ ...d.screenSaver, photos: undefined }, { id: 'none', wait: 10, resumeLogon: false, photos: undefined });
// Photos: Windows Pictures, Pan and zoom, Medium, shuffled, in colour
assert.deepStrictEqual(d.screenSaver.photos, { source: 'windows', workspace: 'current', age: 'any', favorites: false, search: null, folder: null, theme: 'panzoom', speed: 'medium', shuffle: true, monotone: false });
const ph = normalize({ screenSaver: { id: 'photos', photos: { source: 'folder', folder: { path: '/Workspaces/x/Pictures', label: 'Pictures' }, theme: 'stack', speed: 'fast', monotone: true, age: 'week', favorites: true } } }).screenSaver.photos;
assert.strictEqual(ph.source, 'folder');
assert.deepStrictEqual(ph.folder, { path: '/Workspaces/x/Pictures', label: 'Pictures' });
assert.strictEqual(ph.theme, 'stack');
assert.strictEqual(ph.monotone, true);
assert.strictEqual(normalize({ screenSaver: { photos: { theme: 'kaleidoscope', source: 'ftp' } } }).screenSaver.photos.theme, 'panzoom', 'unknown themes fall back');
assert.strictEqual(normalize({ intensity: 200 }).intensity, P.INTENSITY_MAX, 'intensity clamps to 85');
assert.strictEqual(normalize({ intensity: 1 }).intensity, P.INTENSITY_MIN, 'and to 10');
assert.strictEqual(normalize({ windowColor: 'chartreuse' }).windowColor, 'clear', 'unknown colours fall back');
assert.strictEqual(normalize({ screenSaver: { id: 'flying-toasters' } }).screenSaver.id, 'none');
assert.strictEqual(normalize({ screenSaver: { wait: 0 } }).screenSaver.wait, 1);

// Vista's eight presets as measured on the VM, alpha = the slider position
const blue = P.swatch('blue');
assert.deepStrictEqual(blue.rgb, [0, 74, 222]);
assert.strictEqual(blue.intensity, 66);
assert.strictEqual(P.swatch('default').intensity, 27);
assert.deepStrictEqual(P.SWATCHES.map((s) => s.id), ['clear', 'workspace', 'default', 'graphite', 'blue', 'teal', 'red', 'orange', 'pink', 'frost']);

// colour CSS: windows only; the workspace look at its own intensity writes nothing
assert.strictEqual(cssFor(normalize({ windowColor: 'workspace' })), '', 'the old workspace frame is untouched');
const css = cssFor(normalize({ windowColor: 'blue', intensity: 66 }));
assert.ok(css.includes('.modal { --glass-windows-bg: rgb(0 74 222 / 0.66); }'), 'frames take the colour at its intensity');
// intensity is for the window frames only: the taskbar and Start menu glass never change
for (const p of [{ windowColor: 'blue', intensity: 10 }, { windowColor: 'blue', intensity: 85 }, { windowColor: 'clear', transparency: false }]) {
    const out = cssFor(normalize(p));
    assert.ok(!/desktop-taskbar|startMenu|start-menu/.test(out), 'no taskbar or Start menu rules');
}
assert.ok(cssFor(normalize({ windowColor: 'blue', transparency: false })).includes('rgb(0 74 222 / 1)'), 'no transparency = opaque frames');
assert.deepStrictEqual(P.hsbToRgb(0, 100, 100), [255, 0, 0]);
assert.deepStrictEqual(P.rgbToHsb(0, 0, 255), { h: 240, s: 100, b: 100 });

// Window Color previews on a layer: the saved settings (screen saver, sounds) are never touched
P.update({ intensity: 40, screenSaver: { id: 'ribbons', wait: 3 } }, { save: false });
const shown = P.preview({ windowColor: 'red', intensity: 70, screenSaver: { id: 'none' } });
assert.strictEqual(shown.intensity, 70, 'the preview shows');
assert.strictEqual(P.get().intensity, 40, 'the saved settings stay');
assert.strictEqual(shown.screenSaver.id, 'ribbons', 'a preview carries only the colour fields');
P.preview(null);
assert.strictEqual(P.get().screenSaver.id, 'ribbons');
const CP = read('public/scripts/comp/cplPersonalization.js');
assert.ok(CP.includes('pers().update({ windowColor: p.windowColor, customColor: { ...p.customColor }, intensity: p.intensity, transparency: p.transparency }'), 'OK saves only the page\'s fields');

// review fixes (2026-10-21): a Preview never locks; automation never idles or locks; boot,
// the server-restart lock and a playing video hold the saver off; the waking press is swallowed
const SSsrc = read('public/scripts/comp/screenSaver.js');
assert.ok(SSsrc.includes("state.showing = 'preview-focus'") && SSsrc.includes("if (was === 'idle-focus') lockOnResume();"), 'the focus Preview never locks');
assert.ok(SSsrc.includes('nav.webdriver === true') && SSsrc.includes('if (isAgentTab() || !settings().resumeLogon) return;'), 'automation never locks');
assert.ok(SSsrc.includes("'boot-staged', 'session-suspended'") && SSsrc.includes('videoPlaying()'), 'boot, restart lock and video hold it off');
assert.ok(SSsrc.includes('swallowRestOfPress()') && SSsrc.includes('INPUT_TYPES.forEach((type) => root.addEventListener(type, onInput'), 'window-level capture, press swallowed');
assert.ok(SSsrc.includes('stop() { dead = true; }'), 'Photos stops fetching with the engine');
assert.ok(read('modules/ws/handlers/90-workspaceHandler.js').includes('normalizeWorkspacePersonalization(settings.personalization)'), 'the broadcast carries normalised settings');

// sounds: per-event file, (None), No Sounds, the startup check box
const S = require('../public/scripts/comp/desktopSounds.js');
assert.strictEqual(S.FILES.length, 15, 'the served WAVs');
const served = require('../modules/desktopSoundsStatic.js');
assert.deepStrictEqual(S.FILES, served.ALLOWED_FILES, 'the Sounds list is the server whitelist');

// the server keeps the same shape
const WorkspaceManager = require('../modules/workspace.js');
const ws = read('modules/workspace.js');
assert.ok(ws.includes('updates.personalization = normalizeWorkspacePersonalization(settings.personalization)'), 'updateWorkspaceSettings stores it');
assert.ok(typeof WorkspaceManager === 'function');
assert.ok(read('modules/ws/handlers/90-workspaceHandler.js').includes('personalization: workspace.personalization'), 'the workspace list sends it');

// screen savers and the dialogs
const SS = require('../public/scripts/comp/screenSaver.js');
assert.deepStrictEqual(SS.IDS.slice().sort(), ['aurora', 'blank', 'bubbles', 'logo', 'mystify', 'photos', 'ribbons']);
assert.deepStrictEqual(P.SCREEN_SAVERS.filter((id) => id !== 'none' && id !== 'focus').sort(), SS.IDS.slice().sort(), 'every choice has a saver');
const D = require('../public/scripts/comp/personalizationDialogs.js');
assert.ok(D._test.screenSaverPage().includes('cpl-pers-monitor'), 'the monitor picture');
assert.ok(D._test.soundsPage().includes('role="tree"'), 'the Program Events tree');
assert.ok(typeof D.openTheme === 'function' && typeof D.openPhotoSettings === 'function' && typeof D.setPhotoSearch === 'function', 'Theme Settings, Photos settings, Image Search hand-back');
assert.ok(!read('public/scripts/comp/personalizationDialogs.js').includes('on-top tbp-window'), 'the dialogs are not always on top');
assert.ok(read('public/scripts/comp/omegasearchDsapApplet.js').includes("state.frameId === 'screensaver'"), 'Image Search saves for the screen saver');
// Windows Logo: logon.scr's logo and flare frames
for (const f of ['logo-saver.png', 'logo-flare-sheet.png', 'logo-flare-small-sheet.png']) assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-personalization', f)), f);
// the taskbar's opacity
const TS = read('public/scripts/comp/taskbarSettings.js');
assert.ok(TS.includes('opacity: 100,') && TS.includes('previewOpacity'), 'taskbar opacity setting');
assert.ok(read('public/scripts/comp/taskbarProperties.js').includes('id="tbp-opacity"'), 'Taskbar tab Opacity slider');
assert.ok(D.EVENT_GROUPS.flatMap((g) => g.events.map(([id]) => id)).every((id) => S.SCHEME[id]), 'every listed event is a scheme event');

// wiring
const html = read('public/app.html');
assert.ok(html.includes('scripts/comp/desktopPersonalization.js') && html.includes('scripts/comp/screenSaver.js'), 'core scripts load at boot');
const loader = read('public/scripts/comp/featureLoader.js');
assert.ok(loader.includes("'scripts/comp/cplPersonalization.js'") && loader.includes("'scripts/comp/personalizationDialogs.js'") && loader.includes("'css/cpl-personalization.css'"), 'Control Panel loads the pages');
assert.ok(read('public/scripts/comp/focusOverlayManager.js').includes('window.screenSaver.showForFocusLoss()'), 'the focus cover shows the screen saver');
assert.ok(read('public/scripts/comp/melatonControlPanel.js').includes('page.parent'), 'subpages show their parent in the address');

// check boxes and radios: hot fades in and out on an ::after layer, never by moving the sprite (7.css's
// .4s transition on the box slid it between frames)
const GC = read('public/css/vista-glass-controls.css');
assert.ok(!/label:hover::before \{ background-position-y/.test(GC), 'no hot frame on the box itself');
assert.ok(GC.includes('+ label:hover::after { opacity: 1; transition-duration: 0.1s; }'), 'labelled boxes fade in');
assert.ok(GC.includes(':is(:hover, label:hover > *)::after { opacity: 1; transition-duration: 0.1s; }'), 'bare inputs fade in');
assert.ok((GC.match(/transition: opacity 0\.5s linear;/g) || []).length >= 3, 'and fade out slowly');
const TBP = read('public/css/taskbar-properties.css');
assert.ok(!/:hover input[^{]*::before \{ background-position-y/.test(TBP) && TBP.includes(':hover input:not(#_):enabled + label::after { opacity: 1;'), 'sheet controls light the layer');

console.log('test-desktop-personalization: ok');
