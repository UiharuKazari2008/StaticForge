#!/usr/bin/env node
// Vista logon branding (Yozora #495): the Welcome screen's bottom-centre strip is the Dreamscape
// mark + "Dreamscape" in Segoe UI + "2026 R7" in the light weight (Server 2008 R2 style), built by
// scripts/build-vista-logon-branding.sh into the slot the Windows flag + "Windows Vista" used.
// Run: node scripts/test-vista-logon-branding.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('public/css/desktop-boot.css');
const build = read('scripts/build-vista-logon-branding.sh');

// the slot: same place under the logon, the wider strip
assert.ok(css.includes("url('/static_images/vista-logon/branding.png') center bottom 23px / 400px 50px no-repeat"), 'branding drawn at center bottom 23px, 400x50');
assert.ok(css.includes('scripts/build-vista-logon-branding.sh'), 'the sheet names the build script');

// the build: two runs, regular then light, plus the mark; keyboard characters only
assert.ok(build.includes('"Dreamscape"') && build.includes('"2026 R7"'), 'the two runs');
assert.ok(build.includes('segoeui.ttf') && build.includes('selawkl.ttf'), 'Segoe UI Regular for the name, Selawik Light for the version');
assert.ok(build.includes('logo_icon.png'), 'the Dreamscape mark replaces the flag');
assert.ok(!/[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00d7]/.test(build), 'keyboard characters only');

// the strip itself: a 400x50 PNG with alpha, ink spanning most of the width
const file = 'public/static_images/vista-logon/branding.png';
assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} exists`);
const buf = fs.readFileSync(path.join(ROOT, file));
assert.strictEqual(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, '400x50', 'branding.png is 400x50');
assert.strictEqual(buf.readUInt8(25), 6, 'branding.png is RGBA (white on transparent)');
console.log('test-vista-logon-branding: ok');
