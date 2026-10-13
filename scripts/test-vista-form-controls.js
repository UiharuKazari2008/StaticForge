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
    assert.ok(r.includes(':not(.win7 *)') && r.includes(':not(#manualModal *)'), `7.css content and Studio keep theirs: ${r.slice(0, 80)}`);
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
