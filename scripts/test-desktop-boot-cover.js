#!/usr/bin/env node
// Static stage-order check for the desktop boot cover (Yozora #1230 part 3): a black cover element is
// created first in the body, covers everything until the logon has painted, and the desktop state is never
// "desktop" while the boot's layers are held. Run: node scripts/test-desktop-boot-cover.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rd = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = rd('public/app.html');
const ws = rd('public/scripts/websocket.js');
const boot = rd('public/scripts/comp/desktopBoot.js');
const bridge = rd('public/scripts/comp/agentClientBridge.js');

// cover css: black, fixed, above every desktop layer, below the logon layer (2147482000), keyed to boot-staged
const css = app.match(/body\.desktop-mode\.boot-staged:not\(\.boot-cover-off\) #desktopBootCover \{([^}]*)\}/);
assert(css, 'cover css rule missing');
assert(/background:\s*#000/.test(css[1]) && /position:\s*fixed/.test(css[1]) && /inset:\s*0/.test(css[1]), 'cover must be a black fixed full-screen layer');
const z = Number((css[1].match(/z-index:\s*(\d+)/) || [])[1]);
assert(z > 2147481010 && z < 2147482000, 'cover z-index must sit above the desktop layers and below the logon layer: ' + z);

// cover element is created in applyDesktopStartupClasses, first child of body, together with boot-staged
const fn = app.slice(app.indexOf('window.applyDesktopStartupClasses = function'));
const stagedAt = fn.indexOf("classList.add('boot-staged')");
const coverAt = fn.indexOf("cover.id = 'desktopBootCover'");
assert(stagedAt > 0 && coverAt > stagedAt && coverAt < fn.indexOf('};'), 'cover must be made inside applyDesktopStartupClasses');
assert(/insertBefore\(cover, document\.body\.firstChild\)/.test(fn), 'cover must be the first element in body');

// order: the logon painting lifts it, the staged boot (after the logon) also lifts it - nothing else, nothing earlier
const painted = ws.slice(ws.indexOf('_logonPainted() {'));
const paintedBody = painted.slice(0, painted.indexOf('\n    }\n'));
assert(paintedBody.indexOf('_logonPaintedOnce = true') < paintedBody.indexOf("boot-cover-off"), 'cover lifts after the logon painted');
assert(/classList\.add\('boot-staged', 'boot-cover-off'\)/.test(boot), 'desktopBoot.begin lifts the cover (logon already handed off)');
const adds = [...(app + ws + boot).matchAll(/add\([^)]*boot-cover-off/g)].length;
assert(adds === 4, 'cover lifted in exactly 4 places (teal cut, 10 s cap, logon painted, begin): ' + adds);
assert(/remove\('boot-cover-off'\)/.test(boot), 'finish clears the release flag');

// the reveal stages stay hidden behind boot-staged until their own class
['wallpaper', 'icons', 'taskbar', 'gadgets', 'windows'].forEach((s) => {
    assert(fs.readFileSync(path.join(__dirname, '..', 'public/css/desktop-boot.css'), 'utf8').includes(`:not(.boot-reveal-${s})`), 'stage ' + s);
});

// getClientDesktopState: logon check first, then boot-staged holds it at booting, "desktop" last
const st = bridge.slice(bridge.indexOf('function computeDesktopState'));
const i1 = st.indexOf("return 'logon'"), i2 = st.indexOf("contains('boot-staged')"), i3 = st.indexOf("return 'desktop'");
assert(i1 > 0 && i1 < i2 && i2 < i3, 'logon, then booting while staged, then desktop');
console.log('test-desktop-boot-cover: ok');
