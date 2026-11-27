#!/usr/bin/env node
// No Dreamscape event plays one of WM's Alarm files unless Yukimi picked it herself (Yozora #1321, Nov 26 2026).
// Reads the sources and checks every shipped default: the phone's event table, the hour chime and the alarm clock.
// Silent: it reads files and plays nothing.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const ALARM = /^alarm-?\d/i;

const shell = read('public/scripts/comp/wmShell.js');
const from = shell.indexOf('    const SND_EVENTS = [');
const to = shell.indexOf('    ];\n', from);
assert(from > 0 && to > from, 'SND_EVENTS found');
const rows = [...shell.slice(from, to).matchAll(/\{ id: '([^']+)',[^\n]*?sound: '([^']+)'/g)];
assert(rows.length >= 20, `event rows read (${rows.length})`);
for (const [, id, file] of rows) {
    assert(!ALARM.test(file), `event '${id}' defaults to ${file}`);
    assert(fs.existsSync(path.join(root, 'public/sounds/wm61', file)), `event '${id}': ${file} exists`);
}
// a later assignment (6.5.1's reminder) may not put one back
for (const m of shell.matchAll(/SND_EVENTS\.find\([^\n]*?\.sound = '([^']+)'/g)) assert(!ALARM.test(m[1]), `an override gives ${m[1]}`);
// the phone app is told which sounds are her own picks
assert(/out\[e\.id\] = \{ sound: url, own: !!p\.own,/.test(shell), 'the table sent to the app carries own');

const chime = require('../modules/hourChime');
for (const k of ['hourSound', 'halfSound']) assert(!ALARM.test(chime.DEFAULTS[k]), `hour chime ${k} defaults to ${chime.DEFAULTS[k]}`);

const clock = read('public/scripts/comp/wmLock65.js').match(/const ALARM_SOUND = '([^']+)'/);
assert(clock, 'the alarm clock names its default sound');
assert(!ALARM.test(clock[1]), `a new alarm defaults to ${clock[1]}`);

console.log(`ok: ${rows.length} events, the hour chime and the alarm clock default to no Alarm file`);
