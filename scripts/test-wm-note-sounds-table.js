#!/usr/bin/env node
/**
 * The phone's sound table for the Android app (AndroidBars.noteSounds, StaticForge #1367): with the page asleep the app
 * plays from it, so it must be silent exactly where the page is - the workspace's scheme "No Sounds", an "Enable sounds
 * for" group or one event set to (None), a class that ships silent - and hold every phone sound event (an id it lacks
 * falls back to Other notifications in the app). It is sent again when the workspace's sound settings change, only when
 * it changed, and an older run never overwrites a newer one.
 *
 * Runs the real event table, eventPrefs, sendNoteSounds and playSystemSound cut out of wmShell.js. Nothing sounds.
 *
 *   node scripts/test-wm-note-sounds-table.js [path/to/wmShell.js]
 *
 * The optional path is for proving the checks can fail (a copy of the shell without the change).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHELL = process.argv[2] || path.join(__dirname, '..', 'public/scripts/comp/wmShell.js');
const src = fs.readFileSync(SHELL, 'utf8');

function cut(marker, endMarker, keepEnd) {
    const from = src.indexOf(marker);
    assert(from > 0, `marker not found in ${SHELL}: ${marker}`);
    const end = endMarker || '\n    }\n';
    const to = src.indexOf(end, from);
    assert(to > from, `end not found after: ${marker}`);
    return src.slice(from, !endMarker || keepEnd ? to + end.length : to);
}
const optional = (marker, endMarker) => (src.includes(marker) ? cut(marker, endMarker, true) : '');

const code = [
    cut("    const SND_BASE = '/sounds/wm61/';", "    // WM's Sound list names"),
    cut('    const SND_EVENTS = [', '\n    ];\n', true),
    cut('    const SND_EVENT = new Map(', '\n', true),
    cut('    const SND_ALIAS = {', '\n    };\n', true),
    cut('    function eventPrefs(id, prefs) {'),
    optional('    function workspaceSilences(event) {', '\n    }\n'),
    optional('    function workspacePick(event) {', '\n    }\n'),
    optional('    const noteDeskEvent = (id) => ', '\n'),
    cut("    let noteSoundsSent = '';", "    /**\n     * The server raises the phone's notifications too"),
    cut('    function noteSoundChoice(id) {'),
    cut('    async function playSystemSound(name, opts = {}) {'),
    'this.api = { SND_EVENTS, sendNoteSounds, playSystemSound };',
].join('\n');

const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };

/** One phone: o.ws = the workspace's sound settings (desktopPersonalization soundFile's two inputs), o.ev = this device's. */
function world(o = {}) {
    const sent = [];
    const played = [];
    const listeners = new Map();
    const state = { ws: o.ws || { scheme: 'default', sounds: {} }, ev: o.ev || {}, version: null };
    const snd = { last: 0, ctx: { state: 'running' } };
    const ctx = {
        WM651: false,
        AV: null,
        appScopeSignal: undefined,
        soundPrefs: () => ({ ev: JSON.parse(JSON.stringify(state.ev)) }),
        dovecoteMail: () => null,
        sndVersion: (p) => (state.version ? state.version(p) : Promise.resolve('')),
        soundMode: () => 'on',
        vibrate() {},
        vibrationPrefs: () => ({ alerts: false }),
        sndSilentNow: () => false,
        snd,
        sndNote() {},
        sndPlayFile: async (f) => { played.push(f); return true; },
        avPlay: (p) => { played.push(p); return true; },
        location: { origin: 'https://sf.test' },
        document: { addEventListener: (type, fn) => listeners.set(type, fn) },
        window: {
            desktopSounds: { FILES: ['Windows Ding.wav', 'Windows Notify.wav'], SCHEME: { balloon: 'Windows Notify.wav' }, playFile: async (f) => { played.push(f); return true; } },
            AndroidBars: { noteSounds: (json) => sent.push(JSON.parse(json)) },
            // desktopPersonalization.soundFile: No Sounds silences all; else an event's own pick ('' = None)
            desktopPersonalization: {
                soundFile: (event) => {
                    if (state.ws.scheme === 'none') return '';
                    return Object.prototype.hasOwnProperty.call(state.ws.sounds, event) ? state.ws.sounds[event] : undefined;
                },
            },
        },
        Date, Array, Object, String, Math, JSON, Map, Set, Promise, encodeURIComponent,
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx, { filename: 'wmShell.js (cut)' });
    const api = ctx.api;
    return {
        api, sent, played, state, listeners,
        async table() { api.sendNoteSounds(); await flush(); return sent[sent.length - 1]; },
        /** The file the page plays for this class, '' when none. */
        async pageFile(id) {
            snd.last = 0;
            const before = played.length;
            await api.playSystemSound(id, id === 'error' ? { event: 'error' } : {});
            return played.length > before ? decodeURIComponent(String(played[played.length - 1]).split('/').pop()) : '';
        },
        /** What the page plays for a notification of this class (soundNewNotes: an error note follows Program Error). */
        async pagePlays(id) {
            snd.last = 0;
            const before = played.length;
            await api.playSystemSound(id, id === 'error' ? { event: 'error' } : {});
            return played.length > before;
        },
    };
}

let step = 0;
let failed = 0;
async function check(name, fn) {
    ++step;
    try { await fn(); console.log(`  ${step}. ok   ${name}`); } catch (e) { failed++; console.log(`  ${step}. FAIL ${name}\n       ${String(e && e.message).split('\n').slice(0, 14).join('\n       ')}`); }
}

/** The table and the page agree for every event: sound '' exactly where the page plays nothing. */
async function agree(w, table, label) {
    const differ = [];
    for (const e of w.api.SND_EVENTS) {
        const plays = await w.pagePlays(e.id);
        const entry = table[e.id];
        if (!entry) { differ.push(`${e.id}: not in the table`); continue; }
        if ((entry.sound !== '') !== plays) differ.push(`${e.id}: page ${plays ? 'plays' : 'silent'}, table ${entry.sound || 'silent'}`);
    }
    assert.deepStrictEqual(differ, [], `${label}: table and page differ`);
}

async function main() {
    await check('every phone sound event is in the table, with its vibrate / repeat / own / label; an event class says display', async () => {
        const w = world({ ev: { reminder: { vibrate: true }, notification: { sound: 'Alarm1.mp3', repeat: true } } });
        const t = await w.table();
        assert.deepStrictEqual(Object.keys(t).sort(), Array.from(w.api.SND_EVENTS, (e) => e.id).sort());
        assert.deepStrictEqual([t.reminder.vibrate, t.reminder.repeat, t.reminder.label], [true, true, 'Reminders']);
        assert.deepStrictEqual([t.notification.own, t.notification.repeat, t.notification.sound], [true, true, 'https://sf.test/sounds/wm61/Alarm1.mp3']);
        for (const e of w.api.SND_EVENTS.filter((x) => x.kind !== 'note')) assert.strictEqual(t[e.id].display, true, `${e.id}: the app keeps drawing its boxes`);
    });
    await check('as shipped: silent classes are sent silent, and the table agrees with the page', async () => {
        const w = world();
        const t = await w.table();
        for (const id of ['connect', 'disconnect', 'battery-full', 'update', 'info', 'menu', 'question']) assert.strictEqual(t[id] && t[id].sound, '', id);
        await agree(w, t, 'as shipped');
    });
    await check('the sound scheme "No Sounds": every entry silent, as the page (a picked sound too)', async () => {
        const w = world({ ws: { scheme: 'none', sounds: {} }, ev: { notification: { sound: 'Alarm1.mp3' } } });
        const t = await w.table();
        assert.deepStrictEqual(Object.entries(t).filter(([, x]) => x.sound !== '').map(([id]) => id), []);
        assert.strictEqual(t.reminder.repeat, true, 'the rest of the entry stays');
        await agree(w, t, 'No Sounds');
    });
    await check('an "Enable sounds for" group off, or one event (None), silences those classes only', async () => {
        const w = world({ ws: { scheme: 'default', sounds: { balloon: '', notify: '' } } });
        const t = await w.table();
        assert.strictEqual(t.reminder.sound, '', 'follows the balloon event');
        assert.strictEqual(t.mail.sound, '', 'follows the notify event');
        assert.notStrictEqual(t['weather-severe'].sound, '', 'follows warning, still on');
        await agree(w, t, 'balloon and notify off');
    });
    await check('the Errors class follows Program Error, as the page\'s error notification does', async () => {
        const a = world({ ws: { scheme: 'default', sounds: { error: '' } } });
        const ta = await a.table();
        assert.strictEqual(ta.error.sound, '');
        await agree(a, ta, 'Program Error off');
        const b = world({ ws: { scheme: 'default', sounds: { 'critical-stop': '' } } });
        const tb = await b.table();
        assert.notStrictEqual(tb.error.sound, '');
        await agree(b, tb, 'Critical Stop off');
    });
    await check('a desktop sound picked for an event in the workspace is the table\'s file, as in the page, and the phone\'s own pick wins', async () => {
        const w = world({ ws: { scheme: 'default', sounds: { balloon: 'Windows Ding.wav' } }, ev: { sms: { sound: 'drive.mp3' } } });
        const t = await w.table();
        assert.strictEqual(t.reminder.sound, 'https://sf.test/sounds/vista/Windows%20Ding.wav');
        assert.strictEqual(t.reminder.own, true, 'the app\'s Notification sound choice does not replace it, as in the page');
        assert.strictEqual(await w.pageFile('reminder'), 'Windows Ding.wav');
        assert.strictEqual(t.sms.sound, 'https://sf.test/sounds/wm61/drive.mp3');
        assert.strictEqual(await w.pageFile('sms'), 'drive.mp3');
        assert.strictEqual(t.connect.sound, '', 'a class shipped silent stays silent whatever the workspace picked');
        assert.strictEqual(t.connect.own, false);
    });
    await check('own: her picks and every event class\'s sound; a notification class\'s default is not', async () => {
        const t = await world({ ws: { scheme: 'default', sounds: { balloon: 'Windows Notify.wav' } } }).table();
        assert.strictEqual(t.reminder.own, false, 'the scheme\'s own file is no pick');
        assert.ok(/\/wm61\//.test(t.reminder.sound));
        assert.strictEqual(t.error.own, true);
        assert.strictEqual(t.beep.own, true);
    });
    await check('sent again when the workspace\'s sound settings change, and only when the table changed', async () => {
        const w = world();
        await w.table();
        assert.strictEqual(w.sent.length, 1);
        const changed = w.listeners.get('desktopPersonalizationChanged');
        assert.ok(changed, 'listens to desktopPersonalizationChanged');
        changed(); await flush();
        assert.strictEqual(w.sent.length, 1, 'nothing changed: nothing sent');
        w.state.ws = { scheme: 'none', sounds: {} };
        changed(); await flush();
        assert.strictEqual(w.sent.length, 2);
        assert.strictEqual(w.sent[1].reminder.sound, '');
    });
    await check('two runs that overlap: the older settings\' table never goes after the newer one', async () => {
        const w = world();
        const held = [];
        w.state.version = () => new Promise((resolve) => held.push(() => resolve('')));
        w.api.sendNoteSounds(); // the old settings, waiting for a file's version
        await flush();
        w.state.version = null;
        w.state.ev = { reminder: { vibrate: true, sound: '' } };
        w.api.sendNoteSounds(); // the new ones, done at once
        await flush();
        for (let i = 0; i < 80; i++) { while (held.length) held.shift()(); await flush(); if (!held.length) break; }
        assert.strictEqual(w.sent.length, 1, `one table sent (got ${w.sent.length}, the last with reminder vibrate ${w.sent[w.sent.length - 1].reminder.vibrate})`);
        assert.deepStrictEqual([w.sent[0].reminder.vibrate, w.sent[0].reminder.sound], [true, ''], 'the newer one');
    });

    if (failed) { console.log(`test-wm-note-sounds-table: ${failed} of ${step} FAILED`); process.exit(1); }
    console.log('test-wm-note-sounds-table: ok');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
