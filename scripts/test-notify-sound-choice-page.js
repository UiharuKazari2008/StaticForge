#!/usr/bin/env node
/**
 * The page side of the Notification sound choice (StaticForge #1298): with the page in front a notification asks the
 * app (window.AndroidSounds.note(eventId)) what to play, because the app stands down while the page is awake.
 * Runs the real source of playSystemSound and noteSoundChoice, cut out of wmShell.js by their start markers, in a vm
 * with stubbed dependencies. No sound is played.
 *
 *   node scripts/test-notify-sound-choice-page.js [path/to/wmShell.js]
 *
 * The optional path is for proving the checks can fail (run it on a copy of the shell without the change).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHELL = process.argv[2] || path.join(__dirname, '..', 'public/scripts/comp/wmShell.js');
const src = fs.readFileSync(SHELL, 'utf8');

/** The source of one function: its start marker to the first line that is exactly the function's closing brace. */
function cut(marker) {
    const from = src.indexOf(marker);
    assert(from > 0, `marker not found in ${SHELL}: ${marker}`);
    const to = src.indexOf('\n    }\n', from);
    assert(to > from, `closing line not found after: ${marker}`);
    return src.slice(from, to + 6);
}
const code = `${cut('    function noteSoundChoice(id) {')}\n${cut('    async function playSystemSound(name, opts = {}) {')}\nthis.playSystemSound = playSystemSound;`;

const NOTE = { id: 'sms', kind: 'note', sound: 'Infbeg.wav', desktop: 'balloon' };
const ERROR = { id: 'error', kind: 'error', sound: 'Critical.wav', desktop: 'error' };

/**
 * One world: o.note is the bridge's note() (a function, absent for an old app), o.prefs the event's preferences,
 * o.desk the workspace's file for the event, o.silent the phone's sound mode.
 */
function world(o = {}) {
    const log = [];
    const played = [];
    const asked = [];
    const snd = { last: 0, ctx: { state: 'running' }, log };
    const bridge = o.noBridge ? undefined : {};
    if (bridge && o.note) bridge.note = (id) => { asked.push(id); return o.note(id); };
    const ds = { FILES: ['Vista Ding.wav'], SCHEME: { balloon: 'Vista Balloon.wav' }, playFile: async (f) => { played.push(`desk:${f}`); return true; } };
    const ctx = {
        SND_EVENT: new Map([['sms', NOTE], ['error', ERROR]]),
        SND_ALIAS: {},
        eventPrefs: () => Object.assign({ sound: 'Mine.wav', own: false, vibrate: false }, o.prefs || {}),
        soundMode: () => 'on',
        vibrate: () => {},
        vibrationPrefs: () => ({ alerts: false }),
        sndSilentNow: () => !!o.silent,
        snd,
        AV: null,
        WM_SOUNDS: ['Mine.wav', 'Infbeg.wav', 'Critical.wav', 'Hers.wav'],
        sndNote: (id, event, file, at) => log.push({ id, event, file, at }),
        sndPlayFile: async (f, gain, usage) => { played.push(`${f}:${usage}`); return { stop() {} }; },
        avPlay: () => null,
        window: {
            desktopPersonalization: { soundFile: () => o.desk },
            desktopSounds: ds,
            AndroidSounds: bridge
        },
        Date, Array, Object, String, Math, encodeURIComponent
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx, { filename: 'wmShell.js (cut)' });
    return { play: (n, opts) => ctx.playSystemSound(n, opts), played, asked, log, snd };
}

let step = 0;
const ok = (msg) => console.log(`  ${++step}. ${msg}`);

async function main() {
    // 1. no bridge at all: as before
    {
        const w = world({ noBridge: true });
        assert.strictEqual(await w.play('sms'), true);
        assert.deepStrictEqual(w.played, ['Mine.wav:notification']);
        ok('no bridge: the event\'s WM file plays');
    }
    // 2. chosen: the app played it, the page plays nothing
    {
        const w = world({ note: () => 'chosen' });
        assert.strictEqual(await w.play('sms'), true, 'it started');
        assert.deepStrictEqual(w.played, [], 'no file is played by the page');
        assert.deepStrictEqual(w.asked, ['sms'], 'the bridge was asked with the event id');
        assert.strictEqual(w.log.length, 1);
        assert.strictEqual(w.log[0].file, 'android/chosen');
        assert.strictEqual(w.log[0].id, 'sms');
        assert(w.snd.last > 0, 'the rate limit clock is set');
        ok('chosen: nothing played, returns true, logged as android/chosen, the bridge got the event id');
    }
    // 3. silent
    {
        const w = world({ note: () => 'silent' });
        assert.strictEqual(await w.play('sms'), false);
        assert.deepStrictEqual(w.played, []);
        assert.deepStrictEqual(w.asked, ['sms']);
        assert.strictEqual(w.log.length, 0);
        ok('silent (None): nothing played, returns false');
    }
    // 4. event
    {
        const w = world({ note: () => 'event' });
        assert.strictEqual(await w.play('sms'), true);
        assert.deepStrictEqual(w.played, ['Mine.wav:notification']);
        assert.deepStrictEqual(w.asked, ['sms']);
        ok('event: the WM file plays');
        const odd = world({ note: () => 'whatever' });
        assert.strictEqual(await odd.play('sms'), true);
        assert.deepStrictEqual(odd.played, ['Mine.wav:notification']);
        ok('an answer that is none of the three: the WM file plays');
    }
    // 5. her own pick on the Notifications tab: the bridge is not asked
    {
        const w = world({ note: () => 'chosen', prefs: { own: true, sound: 'Hers.wav' } });
        assert.strictEqual(await w.play('sms'), true);
        assert.deepStrictEqual(w.asked, [], 'not asked');
        assert.deepStrictEqual(w.played, ['Hers.wav:notification'], 'her file plays');
        ok('prefs.own: the bridge is not asked, her file plays');
    }
    // 6. Play sound off
    {
        const w = world({ note: () => 'chosen', prefs: { sound: '' } });
        assert.strictEqual(await w.play('sms'), false);
        assert.deepStrictEqual(w.asked, []);
        assert.deepStrictEqual(w.played, []);
        ok('Play sound off: the bridge is not asked, nothing plays');
    }
    // 7. an event-kind sound never asks
    {
        const w = world({ note: () => 'chosen' });
        assert.strictEqual(await w.play('error'), true);
        assert.deepStrictEqual(w.asked, [], 'error is no notification');
        assert.deepStrictEqual(w.played, ['Mine.wav:media']);
        const s = world({ note: () => 'silent' });
        assert.strictEqual(await s.play('error'), true, 'None does not silence an error beep');
        ok('an event-kind sound (error): the bridge is not asked');
    }
    // 8. the bridge throws
    {
        const w = world({ note: () => { throw new Error('bridge gone'); } });
        assert.strictEqual(await w.play('sms'), true);
        assert.deepStrictEqual(w.played, ['Mine.wav:notification']);
        ok('the bridge throws: the WM file plays');
    }
    // 9. a desktop sound picked for the event in this workspace
    {
        const w = world({ note: () => 'chosen', desk: 'Vista Ding.wav' });
        assert.strictEqual(await w.play('sms'), true);
        assert.deepStrictEqual(w.asked, [], 'not asked');
        assert.deepStrictEqual(w.played, ['desk:Vista Ding.wav'], 'that file plays');
        assert.strictEqual(w.log[0].file, 'vista/Vista Ding.wav');
        // the scheme's own default is no pick
        const d = world({ note: () => 'silent', desk: 'Vista Balloon.wav' });
        assert.strictEqual(await d.play('sms'), false);
        assert.deepStrictEqual(d.asked, ['sms'], 'the scheme default is not her pick: asked');
        ok('a workspace desktop pick: the bridge is not asked and that file plays (the scheme default does ask)');
    }
    // 10. an old app: a bridge without note()
    {
        const w = world({});
        assert.strictEqual(await w.play('sms'), true);
        assert.deepStrictEqual(w.played, ['Mine.wav:notification']);
        ok('a bridge without note (older app): the WM file plays');
    }
    // 11. repeats and the 300 ms rate limit
    {
        const w = world({ note: () => 'chosen' });
        assert.strictEqual(await w.play('sms'), true);
        assert.strictEqual(await w.play('sms'), false, 'inside 300 ms, no repeat: dropped');
        assert.deepStrictEqual(w.asked, ['sms'], 'not asked the second time');
        assert.deepStrictEqual(w.played, []);
        assert.strictEqual(await w.play('sms', { again: true }), true, 'a repeat inside 300 ms plays');
        assert.deepStrictEqual(w.asked, ['sms', 'sms'], 'a repeat asks again (it repeats the chosen sound)');
        assert.strictEqual(w.log.length, 2);
        ok('inside 300 ms: a repeat (again) asks again, a second call without again is not asked and plays nothing');
        const s = world({ note: () => 'silent' });
        assert.strictEqual(await s.play('sms'), false);
        assert.strictEqual(await s.play('sms'), false);
        assert.deepStrictEqual(s.asked, ['sms'], 'silent keeps the rate limit too');
        ok('the rate limit holds for the silent answer as well');
    }
    // 12. the phone's sound mode is not On
    {
        const w = world({ note: () => 'chosen', silent: true });
        assert.strictEqual(await w.play('sms'), false);
        assert.deepStrictEqual(w.asked, []);
        assert.deepStrictEqual(w.played, []);
        ok('sound mode not On (sndSilentNow): the bridge is not asked');
    }
    console.log(`ok: ${step} checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
