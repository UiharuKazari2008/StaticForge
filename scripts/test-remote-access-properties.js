#!/usr/bin/env node
// Remote Access Properties (Yukimi 2026-10-21): Remote Access opens a property sheet laid out as
// Vista's System Properties > Remote tab (sysdm.cpl.mui dialog 9002), with Remote Access's settings
// in its places. Run: node scripts/test-remote-access-properties.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

global.window = global;
const rap = require('../public/scripts/comp/remoteAccessProperties.js');
const t = rap._test;

// dialog units as MapDialogRect maps MS Shell Dlg 8 at 96 dpi (6 x 13 base units)
assert.strictEqual(t.dlu(6, 6, 244, 76), 'left:9px;top:10px;width:366px;height:123px;');
assert.strictEqual(t.dlu(181, 60, 62, 14, 1), 'left:273px;top:99px;width:91px;height:20px;', 'a push button draws 1 px inside');

// the Remote tab: dialog 9002's controls, ours in their places
const page = t.pageRemote();
// each control's markup, from its own opening tag to the next control's
const controls = page.split(/(?=<(?:div|button) class="tbp-(?:ctl|group))/).filter((c) => c.trim());
const at = (text) => {
    const c = controls.find((x) => x.includes(text));
    assert.ok(c, text);
    return c;
};
assert.ok(at('Priority Client').includes(t.dlu(6, 6, 244, 76)), 'Remote Assistance group -> Priority Client');
assert.ok(page.includes('id="rap-priority"') && at('riority client for agents').includes(t.dlu(12, 20, 232, 16)));
assert.ok(at('Ad<u>v</u>anced...').includes(t.dlu(181, 60, 62, 14, 1)));
assert.ok(at('>Generation<').includes(t.dlu(6, 93, 244, 124)), 'Remote Desktop group -> Generation');
['detached', 'studio', 'auto'].forEach((v) => assert.ok(page.includes(`name="rap-method" value="${v}"`), v));
assert.ok(at('etached requests').includes(`style="${t.dlu(12, 130, 196, 10)}"`), 'BS_TOP radios: no centring padding');
assert.ok(at('Use the Studio app').includes(t.dlu(12, 148, 196, 17)) && at('Let the agent choose').includes(t.dlu(12, 172, 196, 17)));
assert.strictEqual((page.match(/rap-top rap-multi/g) || []).length, 2, 'the two-line options wrap');
assert.ok(at('pen With...').includes(t.dlu(181, 196, 62, 14, 1)), 'Select Users... -> Open With...');
assert.ok(page.includes('data-action="help-method"') && page.includes('data-action="help-priority"'));
assert.deepStrictEqual(t.OPEN_WITH.map((o) => o.id), ['ledge', 'lumen', 'glancewell', 'disabled'], "the server's openGeneratedImages values");

// state: Remote Access's globals in modalUtils.js and the priority client
global.remoteAccessSettingsState = { defaultGenerationMethod: 'auto', autoGenerate: true, openGeneratedImages: 'lumen', minPrintsPerTurn: 2, maxPrintsPerTurn: 6 };
global.isAgentPriorityClient = () => true;
assert.deepStrictEqual(t.readState(), { priority: true, method: 'auto', autoGenerate: true, openGenerated: 'lumen', minPrints: 2, maxPrints: 6 });
global.remoteAccessSettingsState = { defaultGenerationMethod: 'bogus', openGeneratedImages: 'nope', minPrintsPerTurn: 0, maxPrintsPerTurn: 99 };
delete global.isAgentPriorityClient;
assert.deepStrictEqual(t.readState(), { priority: false, method: 'studio', autoGenerate: false, openGenerated: 'ledge', minPrints: 1, maxPrints: 8 }, 'odd values fall back');

// wiring: every way into Remote Access opens the sheet; Apply saves through modalUtils.js
const src = read('public/scripts/comp/remoteAccessProperties.js');
assert.ok(src.includes('persistRemoteAccessSettingsPatch(patch)') && src.includes("callGlobal('setAgentPriorityClient', p.priority)"), 'Apply saves and registers');
assert.ok(/if \(p\.method !== s\.method\) patch\.defaultGenerationMethod/.test(src), 'only what changed is sent');
assert.ok(read('public/scripts/comp/melatonControlPanel.js').includes('root.remoteAccessProperties.open()'));
assert.ok(read('public/scripts/comp/modalUtils.js').includes('window.remoteAccessProperties.open();'));
const css = read('public/css/remote-access-properties.css');
assert.ok(/\.rap-sheet\s*\{\s*width: 404px;\s*height: 436px;/.test(css), "System Properties' client, 404x436");
assert.ok(/\.rap-settings\s*\{\s*width: 416px;\s*height: 294px;/.test(css), "Remote Assistance Settings' client, 416x294");

// Vista's own check box and radio button art (aero.msstyles), placed as the VM draws them
assert.ok(css.includes('/static_images/vista-controls/checkbox.png') && css.includes('/static_images/vista-controls/radio.png'));
assert.ok(/input\[type="radio"\] \+ label::before \{\s*top: 1px;/.test(css), 'a BS_TOP radio sits 1 px under its top');
assert.ok(/input:checked \+ label::before \{ background-position-y: -52px; \}/.test(css), 'checked is the fifth state');
for (const f of ['checkbox.png', 'radio.png']) assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-controls', f)), f);
// bottom edges drop their fraction: Remote Desktop's frame ends at 352 px (217 DLU = 352.6)
assert.strictEqual(t.dlu(6, 93, 244, 124), 'left:9px;top:151px;width:366px;height:201px;');
assert.ok(t.checkStyle(28, 42, 225, 10).endsWith('padding-top:1px;'), "Remote Assistance Settings' check box: 1 px into a 16 px control");
assert.ok(t.checkStyle(12, 20, 232, 16).endsWith('padding-top:6px;'));

console.log('remote access properties tests passed');
