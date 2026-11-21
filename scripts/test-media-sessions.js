#!/usr/bin/env node
/**
 * melatonMediaSessions.js across two windows of the app (the phone screen and the DeX desktop) on a fake Continuity bus:
 * each window hears what the other plays, pull() moves a session (it stops where it was), push() sends one, a program
 * that starts playing in one window stops in the other, and a window leaving clears its sessions.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/melatonMediaSessions.js'), 'utf8');

function makeWindow(name) {
    const listeners = new Map();
    const w = { name, peerWin: null, timers: [] };
    const c = {
        available: true,
        peers: () => (w.peerWin ? ['other'] : []),
        on(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); return () => {}; },
        post(msg) { if (!w.peerWin) return false; const copy = JSON.parse(JSON.stringify(msg)); w.peerWin.deliver.push(copy); return true; },
        ask(type, payload) {
            return new Promise((resolve) => {
                const rid = 'r' + Math.random();
                w.asking = { rid, resolve };
                c.post(Object.assign({}, payload, { type, rid }));
            });
        }
    };
    w.deliver = [];
    w.receive = (msg) => {
        if (msg.type === 'answer' && w.asking && w.asking.rid === msg.rid) { const r = w.asking.resolve; w.asking = null; r(msg.answer); return; }
        (listeners.get(msg.type) || []).forEach((fn) => fn(msg, 'other'));
    };
    const ctx = { window: null, melatonContinuity: c, console, JSON, Date, Map, Set, Promise, Object, Array,
        setTimeout: (fn) => { w.timers.push(fn); return w.timers.length; } };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    w.media = ctx.melatonMedia;
    w.c = c;
    w.emitPeer = (state) => (listeners.get('peer') || []).forEach((fn) => fn({ state, role: 'other' }));
    return w;
}
// run timers and deliver messages until both windows are quiet
async function settle(a, b) {
    for (let i = 0; i < 50; i++) {
        let did = false;
        for (const w of [a, b]) {
            while (w.timers.length) { w.timers.shift()(); did = true; }
            while (w.deliver.length) { w.receive(w.deliver.shift()); did = true; }
        }
        await new Promise((r) => setImmediate(r));
        if (!did && !a.timers.length && !b.timers.length && !a.deliver.length && !b.deliver.length) return;
    }
}
function radio(w) {
    const st = { channel: null, playing: false, released: [] };
    w.radio = st;
    w.media.register('xmradio', {
        label: 'XM Radio',
        describe: () => (st.channel ? { title: st.channel, subtitle: 'XM', kind: 'radio', source: { channel: st.channel }, playing: st.playing } : null),
        take: (s) => { st.channel = s.source.channel; st.playing = true; return true; },
        release: (why) => { st.released.push(why); if (!st.channel) return null; const s = { title: st.channel, kind: 'radio', source: { channel: st.channel }, playing: st.playing }; st.channel = null; st.playing = false; return s; }
    });
}

(async () => {
    const phone = makeWindow('phone');
    const desk = makeWindow('desk');
    radio(phone); radio(desk);
    // outside the app / alone: nothing elsewhere, nothing sent
    phone.radio.channel = 'Hits 1'; phone.radio.playing = true; phone.media.changed('xmradio');
    await settle(phone, desk);
    assert.strictEqual(desk.media.elsewhere('xmradio'), null, 'no other window: nothing is sent');
    // the DeX window joins: it hears what the phone plays
    phone.peerWin = desk; desk.peerWin = phone;
    phone.emitPeer('joined'); desk.emitPeer('joined');
    await settle(phone, desk);
    const seen = desk.media.elsewhere('xmradio');
    assert.ok(seen && seen.title === 'Hits 1' && seen.playing === true, 'the desktop knows what the phone plays');
    assert.deepStrictEqual(Object.keys(desk.media.sessions().there), ['xmradio'], 'sessions() lists it');
    // opening XM Radio on the desktop takes the session over: it plays here, stops on the phone
    assert.strictEqual(await (async () => { const p = desk.media.pull('xmradio'); await settle(phone, desk); return p; })(), true, 'pull() succeeds');
    assert.strictEqual(desk.radio.channel, 'Hits 1', 'the desktop plays the channel');
    assert.strictEqual(phone.radio.channel, null, 'the phone stopped');
    assert.deepStrictEqual(phone.radio.released, ['taken'], 'released as taken');
    await settle(phone, desk);
    assert.ok(phone.media.elsewhere('xmradio') && phone.media.elsewhere('xmradio').playing, 'the phone now sees it on the desktop');
    // push it back to the phone
    assert.strictEqual(desk.media.push('xmradio'), true, 'push() sends it');
    await settle(phone, desk);
    assert.strictEqual(phone.radio.channel, 'Hits 1', 'the phone plays it again');
    assert.strictEqual(desk.radio.channel, null, 'the desktop stopped');
    // one sound per program: the desktop starts a channel of its own, the phone stops
    desk.radio.channel = 'Octane'; desk.radio.playing = true; desk.media.changed('xmradio');
    await settle(phone, desk);
    assert.strictEqual(phone.radio.channel, null, 'starting on the desktop stops the phone');
    assert.strictEqual(phone.radio.released.slice(-1)[0], 'elsewhere', 'released as elsewhere');
    // a pull with nothing playing over there plays nothing
    phone.radio.channel = null;
    assert.strictEqual(desk.radio.channel, 'Octane');
    // the window leaves: its sessions go
    phone.emitPeer('left');
    await settle(phone, desk);
    assert.strictEqual(phone.media.elsewhere('xmradio'), null, 'a window that left has no sessions');
    console.log('test-media-sessions: ok');
})().catch((e) => { console.error(e); process.exit(1); });
