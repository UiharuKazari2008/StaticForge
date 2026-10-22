#!/usr/bin/env node
// Workspaces splash + Dreamscape 2026 R7 package (Yozora #468): the splash markup on Studio's
// frame, its art and flow-band sheet, the appSplash.js controller (3 s minimum, 1.5 s linger),
// showGalleryWindow opening it from closed, the gallery load progress routed into its corner, the
// All Programs package folder, and the Workspaces rename. Run: node scripts/test-workspaces-splash.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('public/app.html');
const css = read('public/css/manual-modal-splash.css');
const splashJs = read('public/scripts/comp/appSplash.js');
const modalUtils = read('public/scripts/comp/modalUtils.js');
const galleryView = read('public/scripts/comp/galleryView.js');
const docs = read('docs/dreamscape-app-names.md');

// markup: the Workspaces splash on the shared frame, title, 7.css progress bar in the status corner
assert.ok(html.includes('<div id="manualModalSplash" class="app-splash manual-modal-splash hidden">'), 'Studio splash carries the shared .app-splash frame');
assert.ok(html.includes('<div id="workspaceSplash" class="app-splash hidden">'), 'Workspaces splash exists on the shared frame');
assert.ok(html.includes('<img class="splash-bands" src="/static_images/splash/workspaces-bands.webp"'), 'the flow-band sheet');
assert.ok(html.includes('<span class="splash-title-main">Dreamscape Workspaces</span>\n                <span class="splash-title-version">2026 R7</span>'), 'title "Dreamscape Workspaces / 2026 R7"');
assert.ok(html.includes('<div class="splash-status win7">') && html.includes('<div role="progressbar" class="splash-progress marquee animate hidden"'), '7.css (Aero) progress bar in the status corner');
assert.ok(html.includes('<script src="scripts/comp/appSplash.js"></script>\n    <script src="scripts/comp/galleryJumpIndex.js"></script>'), 'appSplash.js loads before the gallery scripts');

// art
for (const file of ['public/static_images/splash/workspaces-bg.jpg', 'public/static_images/splash/workspaces-bands.webp']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
}
const bg = fs.readFileSync(path.join(ROOT, 'public/static_images/splash/workspaces-bg.jpg'));
assert.strictEqual(bg.readUInt16BE(0), 0xffd8, 'the art is a JPEG');
const bands = read('scripts/build-workspaces-splash-bands.sh');
assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/splash/src/workspaces-bands-src.jpg')), 'the bands source art is kept for the build');
assert.ok(bands.includes('W=1080; H=730') && bands.includes('FX=140; FY=140') && bands.includes('EDGE=110'), 'the bands sheet build: frame + 140 px, the outer 110 px fade out (no cut-off bands at the sheet edge)');
assert.ok(bands.includes('-level "${FLOOR}%,100%"'), 'the faint alpha floor is cut, so the sheet never reads as a tinted rectangle');

// css: shared frame, per-splash art, the bands sheet past the frame, the corner progress
assert.ok(css.includes('.app-splash {\n    position: absolute;') && css.includes('width: 800px;\n    height: 450px;'), 'the 800x450 frame is .app-splash');
assert.ok(css.includes("#manualModalSplash .splash-background {\n    background-image: url('/static_images/splash_bg2.jpg');"), "Studio's art stays");
assert.ok(css.includes("#workspaceSplash .splash-background {\n    background-image: url('/static_images/splash/workspaces-bg.jpg');"), "Workspaces' art");
assert.ok(css.includes('#workspaceSplash .splash-bands {\n    position: absolute;\n    top: -140px;\n    left: -140px;\n    width: 1080px;\n    height: 730px;'), 'the bands sheet is the frame plus 140 px each side');
assert.ok(css.includes('#workspaceSplash .splash-status {\n    display: flex;\n    flex-direction: column;\n    align-items: flex-end;'), 'status line over the bar, right-aligned');
assert.ok(!css.includes('#manualModalSplash .splash-content') && !css.includes('#manualModalSplash .splash-status-text'), 'no Studio-only copies of the shared rules');

// controller: desktop only, 3 s minimum, 1.5 s linger, progress through the shared helpers
assert.ok(splashJs.includes('class AppSplash') && splashJs.includes("new AppSplash('workspaceSplash', { minDisplayMs: 3000, lingerMs: 1500 })"), 'workspaceSplash: 3 s minimum, 1.5 s linger');
assert.ok(splashJs.includes('if (!window.isDesktop || !this.el) return false;'), 'desktop mode only');
assert.ok(splashJs.includes('const wait = Math.max(remaining, this.lingerMs);'), 'hide waits the rest of the minimum and at least the linger');
assert.ok(splashJs.includes('applyGalleryProgressBarState(this.progress, this.progressBar, progress, modeRef)') && splashJs.includes('formatGalleryProgressStatusText(progress)'), 'the progress bar and text reuse workspaceUtils.js');

// opening from closed, and the progress routing
assert.ok(modalUtils.includes("const splash = isGalleryWindowHidden() && workspaceSplash.show('Opening Workspaces...');"), 'showGalleryWindow shows the splash when opening from closed');
assert.ok(modalUtils.includes('galleryWindowPreparePromise = prepareGalleryWindowContent().catch('), 'openModal keeps the prepare promise');
assert.ok(modalUtils.includes('const prepared = Promise.resolve(galleryWindowPreparePromise).catch(() => {});')
    && modalUtils.includes('prepared.then(() => workspaceSplash.hide());'), 'the splash hides once the content is ready');
// ... and not before the rows in view show their previews (no BlurHash wall), at most 10 s
assert.ok(modalUtils.includes('workspaceSplash.waitFor(prepared.then(() => waitForGalleryVisiblePreviews(10000)), 10000);'), 'the splash waits for the visible previews');
// ... and the poll stops with the splash: at the cap, or once the window is closed or minimised
assert.ok(/Date\.now\(\) >= deadline \|\| isGalleryWindowHidden\(\) \|\| galleryWindow\.classList\.contains\('minimised'\)/.test(modalUtils), 'the preview poll gives up with the splash');
assert.ok(splashJs.includes('waitFor(ready, capMs)') && /if \(this\.readyGate\) \{\s*const gate = this\.readyGate;\s*gate\.then\(\(\) => this\.hide\(onHidden\)\);/.test(splashJs), 'hide() holds while the ready gate is pending');
assert.ok(read('public/scripts/comp/galleryView.js').includes('function galleryVisiblePreviewsReady()'), 'galleryView.js says when the visible previews are in');
assert.ok(galleryView.includes('if (workspaceSplash.isActive()) {\n        workspaceSplash.setStatus(`Loading ${viewName}...`);\n        return;\n    }'), 'no loading dialog while the splash is up');
assert.ok(galleryView.includes('workspaceSplash.setProgress(progress);\n        if (terminal) workspaceSplash.hide();\n        return;'), 'progress goes to the splash corner; terminal phase hides it');
assert.ok(galleryView.includes('function hideGalleryProgressModal() {\n    // workspaceSplash') && galleryView.includes('    if (workspaceSplash.isActive()) workspaceSplash.hide();\n    if (galleryProgressModal) {'), 'every end of a load hides the splash (with the linger)');

// the package: folder, names, rename
assert.ok(modalUtils.includes("const START_MENU_PACKAGE_FOLDER = 'Dreamscape 2026 R7';"), 'the package folder');
const folderApps = /const START_MENU_PACKAGE_APPS = \[([\s\S]*?)\];/.exec(modalUtils);
assert.ok(folderApps, 'START_MENU_PACKAGE_APPS');
const ids = Array.from(folderApps[1].matchAll(/\['([^']+)', '([^']+)'\]/g)).map((m) => `${m[1]}:${m[2]}`);
assert.deepStrictEqual(ids, ['studio:DreamStudio', 'workspace:Workspaces', 'spellbook:Spellcaster', 'reference:Reference', 'bracket-generation:Phasewalker', 'character-db:Characters', 'expanders:Expanders', 'presets:Spellbook'], "Yukimi's eight apps, in order");
assert.ok(modalUtils.includes(".filter((item) => !isStartMenuPackageApp(item))") && modalUtils.includes('&& !isStartMenuPackageApp(item))\n        .sort(byStartMenuLabel);'), 'package apps leave the top level and Accessories');
assert.ok(modalUtils.includes("folderId: 'dreamscape-r7', text: START_MENU_PACKAGE_FOLDER"), 'the folder is in All Programs');
assert.ok(html.includes('<span>Workspaces</span>') && galleryView.includes('let title = `Workspaces - ${viewName}`;') && modalUtils.includes("text: 'Workspaces',\n        fullName: 'Dreamscape Workspaces',"), 'Workspace is Workspaces');
assert.ok(modalUtils.includes("fullName: 'DreamStudio 2026 R7'"), 'DreamStudio carries the package version');
assert.ok(modalUtils.includes("imageIcon: 'spellcaster.png', text: 'Spellcaster'") && modalUtils.includes("imageIcon: 'characters.png', text: 'Characters'"), 'the new Spellcaster and Characters icons');
for (const file of ['public/static_images/app_icons/spellcaster.png', 'public/static_images/app_icons/characters.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
    const buf = fs.readFileSync(path.join(ROOT, file));
    assert.strictEqual(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, '1024x1024', `${file} is a 1024 master`);
}
assert.ok(docs.includes('## Dreamscape 2026 R7 package') && docs.includes('`workspace` | **Workspaces**'), 'docs/dreamscape-app-names.md has the package section');
console.log('test-workspaces-splash: ok');
