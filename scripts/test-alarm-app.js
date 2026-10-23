#!/usr/bin/env node
// Alarm Clock / Pomodoro as a Melaton app package (apps/alarm, Yozora #642). Wiring only; the timer
// behaviour is unchanged client code. Run: node scripts/test-alarm-app.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateManifest } = require('../modules/melatonPackageStore');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const manifest = validateManifest(JSON.parse(read('apps/alarm/manifest.json')), { trusted: true });
assert.strictEqual(manifest.launchId, 'alarm');
assert.strictEqual(manifest.client.entry, 'client/alarm.js');
assert.ok(!manifest.client.styles, 'Alarm uses the global desktopAppWindows.css, so it ships no CSS');
assert.ok(fs.existsSync(path.join(ROOT, 'apps/alarm/assets/alarm.png')), 'package icon');

const js = read('apps/alarm/client/alarm.js');
assert.ok(js.includes("melatonApps.define('alarm', alarmStart)"), 'registers as the alarm app');
assert.ok(js.includes("app.args && app.args.mode === 'pomodoro'"), 'the pomodoro mode comes from the launch args');
assert.ok(js.includes("programFaults.registerProgram('desktopTimerModal'"), 'registers its window for faults');

const modal = read('public/scripts/comp/modalUtils.js');
assert.ok(modal.includes("melatonApps.launch({ packageId: 'alarm' })"), 'Alarm Clock launches the package');
assert.ok(modal.includes("melatonApps.launch({ packageId: 'alarm', args: { mode: 'pomodoro' } })"), 'Pomodoro launches the package in pomodoro mode');
assert.ok(!read('public/scripts/comp/featureLoader.js').includes('alarmPomodoro.js'), 'no longer a featureLoader feature');
assert.ok(!fs.existsSync(path.join(ROOT, 'public/scripts/comp/desktop-apps/alarmPomodoro.js')), 'moved out of the monolith');

assert.ok(!/[–—‘’“”…×− ]/.test(js), 'keyboard characters only');
console.log('test-alarm-app: ok');
