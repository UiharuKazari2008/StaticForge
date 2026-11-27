#!/usr/bin/env node
/**
 * Playback with the screen off and the page gone (#1322), the page's side of window.AndroidVideos
 * (docs/client-api/android-playback.md). The real wmMedia.js and wmXmRadio.js run in one stubbed window with a fake
 * media element and a fake app player; Videos' player needs a DOM, so its shared-player functions are taken from
 * wmYouTube.js and run on stubs. Covers: reported only while a song plays; the 200-item window and the shuffled play
 * order; 'handed' pauses the page without clearing the report; the take-back's song, place and order; another
 * program's report and stream are never cleared or stopped; a fresh page takes over what plays; the awake holds.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const SRC = {
    media: read('public/scripts/comp/wmMedia.js'),
    xm: read('public/scripts/comp/wmXmRadio.js'),
    videos: read('public/scripts/comp/wmYouTube.js'),
    continuity: read('public/scripts/comp/melatonContinuity.js')
};
const ORIGIN = 'https://dream.test';
const PHONE = 'https://appassets.test/media-lib';

/** The app's one native player, as the bridge contract says it behaves. */
function fakeApp(log, { music = true } = {}) {
    const app = {
        report: '', active: false, state_: 'off', musicNow: null, reports: [], stops: 0,
        bridge: {
            watching(json) { app.report = json || ''; app.reports.push(json || ''); log.push(json ? 'app:watching' : 'app:clear'); },
            handOff() { if (!app.report) return false; app.active = true; app.state_ = 'playing'; log.push('app:handOff'); return true; },
            popOut() { return app.bridge.handOff(); },
            stop() { app.stops++; app.active = false; app.state_ = 'off'; app.musicNow = null; log.push('app:stop'); },
            isActive: () => app.active,
            state: () => app.state_,
            position: () => -1,
            sleep() {}, sleepAt: () => 0
        }
    };
    if (music) {
        app.bridge.musicSupported = () => true;
        app.bridge.musicState = () => (app.active && app.musicNow ? JSON.stringify(app.musicNow) : '');
    }
    /** The app's window is left: its player takes what is reported. */
    app.take = (positionMs = 0) => {
        const r = JSON.parse(app.report);
        app.active = true;
        app.state_ = 'playing';
        app.musicNow = r.music ? { index: r.music.index, positionMs, playing: true } : null;
    };
    return app;
}

/** A page: window, document, a fake <video>/<audio>, timers and events run by flush(). */
function fakePage({ app, store = new Map(), log = [] }) {
    let timers = [];
    let nextTimer = 1;
    const queued = [];
    const held = new Map();
    const nowPlaying = [];
    const media = [];

    class FakeMedia extends EventTarget {
        constructor() { super(); this.attrs = {}; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 200; this.volume = 1; this.muted = false; this.parentNode = null; this.error = null; media.push(this); }
        set src(v) { this.attrs.src = v; this.paused = true; this.ended = false; this.currentTime = 0; this.later('loadedmetadata'); }
        get src() { return this.attrs.src || ''; }
        getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
        removeAttribute(k) { delete this.attrs[k]; }
        load() { this.paused = true; if (!this.attrs.src) this.currentTime = 0; }
        later(t) { queued.push(() => this.dispatchEvent(new Event(t))); }
        play() { log.push(`page:play@${Math.round(this.currentTime)}`); this.paused = false; this.ended = false; this.later('play'); this.later('playing'); return Promise.resolve(); }
        pause() { if (!this.paused) { log.push('page:pause'); this.paused = true; this.later('pause'); } }
        finish() { this.paused = true; this.ended = true; this.later('pause'); this.later('ended'); }
        canPlayType() { return ''; }
        remove() {}
    }

    const winEvents = new EventTarget();
    const docEvents = new EventTarget();
    const root = { dataset: {}, classList: { contains: (c) => c === 'ui-mobile', toggle() {}, add() {}, remove() {} } };
    const document = {
        hidden: false, visibilityState: 'visible', documentElement: root,
        addEventListener: docEvents.addEventListener.bind(docEvents),
        removeEventListener: docEvents.removeEventListener.bind(docEvents),
        dispatchEvent: docEvents.dispatchEvent.bind(docEvents),
        createElement: (tag) => (tag === 'video' || tag === 'audio' ? new FakeMedia() : { style: {}, appendChild() {}, setAttribute() {} }),
        querySelector: () => null, querySelectorAll: () => [], head: { appendChild() {} }
    };
    const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); }
    };
    const registered = {};
    const programs = {};
    const wmShell = {
        version: '6.5', current: 'today', currentApp: () => 'today',
        registerApp: (a) => { registered[a.id] = a; },
        busy: (p) => Promise.resolve(p), notify() {}, open() {}, onScreen: () => false, syncHistory() {}, refreshSoftKeys() {}, refreshTitleAction() {},
        refreshToday() {}, escapeHtml: (s) => String(s), messageBox: () => Promise.resolve(false), art: { img: () => '' }
    };
    const requests = [];
    const window = {
        uiShell: 'mobile', document, localStorage, wmShell,
        location: { href: `${ORIGIN}/app`, origin: ORIGIN },
        navigator: {},
        addEventListener: winEvents.addEventListener.bind(winEvents),
        removeEventListener: winEvents.removeEventListener.bind(winEvents),
        dispatchEvent: winEvents.dispatchEvent.bind(winEvents),
        melatonContinuity: { holdAwake: (r, on) => { const n = (held.get(r) || 0) + (on ? 1 : -1); assert.ok(n === 0 || n === 1, `hold ${r} stays balanced (${n})`); if (n) held.set(r, n); else held.delete(r); } },
        melatonMedia: { register: (id, spec) => { programs[id] = spec; }, changed() {}, offerTransfer() {} },
        AndroidMediaLibrary: { baseUrl: () => PHONE, setNowPlaying: (j) => nowPlaying.push(j) },
        vfsClient: { getBasePath: () => '/vfs-uuid', downloadFile: (id) => { requests.push(id); return Promise.resolve({ downloadUrl: '/dl/x' }); } },
        wsClient: {
            on() {}, isConnected: () => true,
            sendMessage: (type, p) => { requests.push(type); return Promise.resolve(type === 'xmradio_tune' ? { data: { url: `/api/xmradio/live/${p.channelId}.m3u8` } } : { data: {} }); }
        },
        Hls: { isSupported: () => false },
        setTimeout: (fn, ms) => { const id = nextTimer++; timers.push({ id, fn, ms: ms || 0 }); return id; },
        clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
        setInterval: () => 0, clearInterval() {},
        queueMicrotask, console, URL, URLSearchParams, Intl, Event, CustomEvent, Image: class {}, ResizeObserver: class { observe() {} }
    };
    if (app) window.AndroidVideos = app.bridge;
    window.window = window;
    const ctx = vm.createContext(window);

    const settle = () => new Promise((r) => setImmediate(r));
    /** Runs queued media events and every timer due within `upTo` ms, until nothing is left. */
    async function flush(upTo = 1000) {
        for (let n = 0; n < 50; n++) {
            await settle();
            while (queued.length) queued.shift()();
            const due = timers.filter((t) => t.ms <= upTo);
            if (!due.length && !queued.length) { await settle(); if (!queued.length) return; continue; }
            timers = timers.filter((t) => t.ms > upTo);
            due.forEach((t) => t.fn());
        }
    }
    const emit = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));
    const news = (detail) => emit('dreamscape:videos', detail);
    const screen = (on) => { if (on) delete root.dataset.screenOff; else root.dataset.screenOff = '1'; emit('melatonscreen', { on }); };
    const visibility = (hidden) => { document.hidden = hidden; document.visibilityState = hidden ? 'hidden' : 'visible'; document.dispatchEvent(new Event('visibilitychange')); };
    return { window, ctx, store, log, held, nowPlaying, media, programs, registered, requests, flush, emit, news, screen, visibility, run: (src, name) => vm.runInContext(src, ctx, { filename: name }) };
}

const song = (n, extra) => Object.assign({ kind: 'audio', src: 'vfs', serverId: `s${n}`, name: `Song ${n}`, title: `Song ${n}`, artist: 'A', album: 'B' }, extra);
const songs = (n) => Array.from({ length: n }, (_, i) => song(i));
const lastReport = (app) => (app.report ? JSON.parse(app.report) : null);

async function mediaPage(opts = {}) {
    const log = [];
    const app = opts.app === undefined ? fakeApp(log, opts) : opts.app;
    const page = fakePage({ app, store: opts.store, log: app && opts.app ? opts.log || log : log });
    page.app = app;
    page.run(SRC.media, 'wmMedia.js');
    await page.flush();
    page.M = page.window.wmMedia;
    page.el = () => page.media.find((m) => m.getAttribute('src')) || page.media[0];
    /** A control of the app's / lock screen's media buttons (the same code paths as the program's keys). */
    page.control = async (action) => { page.emit('dreamscape:mediacontrol', { action }); await page.flush(); };
    return page;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('an older app: nothing is reported, the page holds itself awake while it plays', async () => {
    const log = [];
    const app = fakeApp(log, { music: false });
    const p = await mediaPage({ app, log });
    p.M.enqueue(songs(3), true);
    await p.flush();
    assert.strictEqual(app.reports.length, 0, 'watching() never called');
    assert.ok(p.held.has('media-page'), 'held while playing');
    assert.strictEqual(p.M.now().native, false);
    p.el().finish();
    await p.flush();
    assert.strictEqual(p.M.now().index, 1, 'the next song follows');
    assert.ok(p.held.has('media-page'), 'still held across the gap');
    await p.control('pause');
    assert.ok(!p.held.has('media-page'), 'paused: the page may sleep');
    p.news({ state: 'handed' });
    assert.strictEqual(p.M.now().native, false);
    assert.strictEqual(app.stops, 0);
});

test('reported only while the page really plays a song; a pause clears at once', async () => {
    const p = await mediaPage();
    assert.strictEqual(p.app.reports.length, 0, 'nothing queued: nothing said');
    p.M.enqueue(songs(3), true);
    assert.strictEqual(p.app.reports.filter(Boolean).length, 0, 'not before the player plays');
    await p.flush();
    const r = lastReport(p.app);
    assert.strictEqual(r.url, `${ORIGIN}/vfs-uuid/media/file/s0`, 'absolute address');
    assert.strictEqual(r.audioOnly, true);
    assert.strictEqual(r.music.index, 0);
    assert.strictEqual(r.music.items.length, 3);
    assert.strictEqual(r.music.items[0].url, r.url);
    assert.strictEqual(r.music.repeat, false);
    assert.strictEqual(r.music.volume, 70);
    const n = p.app.reports.length;
    p.el().currentTime = 5;
    p.el().dispatchEvent(new Event('timeupdate'));
    await p.flush();
    assert.strictEqual(p.app.reports.length, n, 'timeupdate says nothing');
    p.el().dispatchEvent(new Event('seeked'));
    await p.flush();
    assert.strictEqual(lastReport(p.app).music.positionMs, 5000, 'a seek is told');
    p.el().pause();
    await p.flush(0); // the pause event alone, no coalescing wait
    assert.strictEqual(p.app.report, '', 'cleared at once');
    assert.strictEqual(p.store.get('wmNativeSlot'), undefined);
    p.M.enqueue([{ kind: 'video', src: 'vfs', serverId: 'v1', name: 'Film' }], true);
    await p.flush();
    assert.strictEqual(p.app.report, '', 'a video is never reported');
});

test('the window: 200 songs around the playing one, only addresses the app takes, no request made', async () => {
    const p = await mediaPage();
    const list = songs(500);
    list[101] = { kind: 'video', src: 'vfs', serverId: 'v', name: 'Video' };
    list[102] = { kind: 'audio', src: 'vfs', fileId: 'needs-request', name: 'Needs a request' };
    list[103] = { kind: 'audio', url: 'https://elsewhere.test/a.mp3', name: 'Elsewhere' };
    list[104] = { kind: 'audio', src: 'android', url: `${PHONE}/audio/ext/7`, name: 'Phone song', art: `${PHONE}/cover/ext/7` };
    list[105] = song(105, { art: 'data:image/png;base64,AAAA' });
    p.M.enqueue(list, false);
    for (let i = 0; i <= 100; i++) await p.control('next'); // (the queue starts before its first item)
    assert.strictEqual(p.M.now().index, 100);
    const r = lastReport(p.app);
    assert.strictEqual(r.music.items.length, 200);
    assert.strictEqual(r.music.index, 50, 'fifty behind');
    assert.strictEqual(r.music.items[50].url, r.url);
    assert.strictEqual(r.music.items[51].url, `${PHONE}/audio/ext/7`, 'video, request-only and foreign items are left out');
    assert.strictEqual(r.music.items[51].art, `${PHONE}/cover/ext/7`);
    assert.strictEqual(r.music.items[52].art, '', 'never a data: picture');
    assert.ok(!p.requests.includes('needs-request'), 'no request to build the list');
    // the app moves on to its next item: that is queue item 104
    p.app.take(0);
    p.news({ state: 'handed' });
    p.news({ state: 'track', index: 51 });
    await p.flush();
    assert.strictEqual(p.M.now().index, 104, 'the app\'s index mapped back to the queue');
});

test('a playing item the app cannot have is not reported at all', async () => {
    const p = await mediaPage();
    p.M.enqueue([{ kind: 'audio', url: 'https://elsewhere.test/a.mp3', name: 'Stream' }, song(1)], true);
    await p.flush();
    assert.strictEqual(p.app.report, '');
});

test('shuffle: the upcoming songs in an order that stays until the queue changes, mapped back', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(30), true);
    await p.flush();
    // Shuffle is a menu row of the program
    const menu = () => p.registered['windows-media'].softKeys().right.menu();
    const shuffle = () => menu().find((m) => m && m.label === 'Shuffle/Repeat').submenu[0].action();
    shuffle();
    await p.flush();
    const a = lastReport(p.app).music;
    assert.strictEqual(a.index, 0, 'the playing song keeps its place');
    assert.strictEqual(a.items[0].title, 'Song 0');
    const order = a.items.map((x) => x.title);
    assert.deepStrictEqual([...order].sort(), songs(30).map((s) => s.title).sort(), 'every song once');
    assert.notDeepStrictEqual(order, songs(30).map((s) => s.title), 'shuffled');
    p.el().dispatchEvent(new Event('seeked'));
    await p.flush();
    assert.deepStrictEqual(lastReport(p.app).music.items.map((x) => x.title), order, 'stable');
    p.app.take(0);
    p.news({ state: 'handed' });
    p.news({ state: 'track', index: 7 });
    await p.flush();
    assert.strictEqual(`Song ${p.M.now().index}`, order[7]);
    p.app.musicNow = { index: 7, positionMs: 9000, playing: true };
    p.screen(false);
    p.screen(true);
    await p.flush();
    const back = lastReport(p.app).music;
    assert.deepStrictEqual(back.items.map((x) => x.title), order, 'the same order after the take-back');
    assert.strictEqual(back.index, 7);
});

test('handed: the page pauses, keeps the report, clears its media notification, sleeps, shows playing', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(3), true);
    await p.flush();
    p.el().currentTime = 12;
    const report = p.app.report;
    const said = p.app.reports.length;
    p.app.take(12000);
    p.news(JSON.stringify({ state: 'handed' })); // detail may be a JSON string
    p.screen(false);
    p.visibility(true);
    await p.flush();
    assert.strictEqual(p.el().paused, true);
    assert.strictEqual(p.app.reports.length, said, 'no watching() at all: not even ""');
    assert.strictEqual(p.app.report, report);
    assert.strictEqual(p.app.stops, 0);
    assert.strictEqual(p.nowPlaying[p.nowPlaying.length - 1], '', 'one media notification');
    assert.ok(!p.held.has('media-page'), 'the page may sleep');
    const now = p.M.now();
    assert.strictEqual(now.playing, true);
    assert.strictEqual(now.native, true);
    assert.strictEqual(now.status, 'Playing');
    p.news({ state: 'buffering' });
    await p.flush();
    assert.strictEqual(p.M.now().status, 'Buffering...');
    p.news({ state: 'paused' });
    await p.flush();
    assert.strictEqual(p.M.now().playing, false);
    assert.strictEqual(p.app.reports.length, said);
});

test('take-back: the app stops first, the same song goes on at the app\'s place, only for a page in front', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(3), true);
    await p.flush();
    p.app.take(1000);
    p.news({ state: 'handed' });
    p.screen(false);
    await p.flush();
    p.app.musicNow = { index: 0, positionMs: 83000, playing: true };
    p.visibility(false); // visible, screen still off
    await p.flush();
    assert.strictEqual(p.app.stops, 0, 'screen off: stays with the app');
    p.window.document.documentElement.dataset.wmBehind = '';
    p.screen(true);
    await p.flush();
    assert.strictEqual(p.app.stops, 0, 'behind an Android program: stays with the app');
    delete p.window.document.documentElement.dataset.wmBehind;
    p.log.length = 0;
    p.screen(true);
    await p.flush();
    assert.strictEqual(p.app.stops, 1);
    const stop = p.log.indexOf('app:stop');
    const play = p.log.indexOf('page:play@83');
    assert.ok(stop >= 0 && play > stop, `stopped, then played from 83 s: ${p.log.join(' ')}`);
    assert.ok(!p.log.includes('page:play@0'), 'never from the start');
    assert.strictEqual(p.M.now().native, false);
    assert.ok(p.held.has('media-page'));
    assert.strictEqual(lastReport(p.app).music.positionMs, 83000, 'told again, for the next time');
});

test('take-back on another song, paused: loaded at its place and left paused', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(5), true);
    await p.flush();
    p.app.take(0);
    p.news({ state: 'handed' });
    p.news({ state: 'track', index: 2 });
    p.screen(false);
    await p.flush();
    p.app.musicNow = { index: 2, positionMs: 45000, playing: false };
    p.log.length = 0;
    p.screen(true);
    await p.flush();
    assert.strictEqual(p.M.now().index, 2);
    assert.ok(p.el().src.endsWith('/s2'));
    assert.strictEqual(p.el().currentTime, 45);
    assert.strictEqual(p.el().paused, true);
    assert.ok(!p.log.some((l) => l.startsWith('page:play')));
    assert.strictEqual(p.app.report, '', 'paused: nothing to carry on');
});

test('controls: a pause or stop while the page is away ends the app\'s player and keeps the place', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(3), true);
    await p.flush();
    p.app.take(0);
    p.news({ state: 'handed' });
    p.screen(false);
    await p.flush();
    p.app.musicNow = { index: 1, positionMs: 30000, playing: true };
    await p.control('next');
    assert.strictEqual(p.app.stops, 0, 'next from away is the app\'s own button');
    const s = p.programs.mediaplayer.release('taken');
    await p.flush();
    assert.strictEqual(s.position, 30000);
    assert.strictEqual(s.playing, true);
    assert.strictEqual(p.app.stops, 1);
    assert.ok(!p.media.some((m) => !m.paused), 'nothing plays in the page');
    p.screen(true);
    p.M.playPause();
    await p.flush();
    assert.strictEqual(p.M.now().index, 1);
    assert.strictEqual(p.el().currentTime, 30, 'Play carries on from there');
});

test('in front, play / pause and stop take the music back first', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(3), true);
    await p.flush();
    p.app.take(0);
    p.news({ state: 'handed' }); // (a dialog over the app: the page stays in front)
    await p.flush();
    assert.strictEqual(p.app.stops, 0, 'handed alone takes nothing back');
    p.app.musicNow = { index: 0, positionMs: 20000, playing: true };
    p.M.playPause();
    await p.flush();
    assert.strictEqual(p.app.stops, 1);
    assert.strictEqual(p.el().currentTime, 20);
    assert.strictEqual(p.el().paused, true, 'it was playing: the key pauses it');
    p.M.playPause();
    await p.flush();
    p.app.take(25000);
    p.news({ state: 'handed' });
    p.registered['windows-media'].onEnd(); // End Task
    await p.flush();
    assert.strictEqual(p.app.stops, 2);
    assert.strictEqual(p.el().paused, true);
    assert.strictEqual(p.M.now().playing, false);
    assert.strictEqual(p.app.report, '');
});

test('a lost "handed" (frozen page): found when the page comes in front, never two players', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(3), true);
    await p.flush();
    p.app.take(50000);
    p.screen(false);
    await p.flush();
    p.log.length = 0;
    p.screen(true);
    await p.flush();
    assert.deepStrictEqual(p.log.filter((l) => /app:stop|page:play|page:pause/.test(l)), ['page:pause', 'app:stop', 'page:play@50']);
});

test('the app\'s "stopped" ends it; the same news after a take-back changes nothing', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(3), true);
    await p.flush();
    p.app.take(0);
    p.news({ state: 'handed' });
    p.screen(false);
    p.screen(true);
    await p.flush();
    p.news({ state: 'stopped' }); // the take-back's own stop, heard late
    await p.flush();
    assert.strictEqual(p.M.now().playing, true);
    p.app.take(0);
    p.news({ state: 'handed' });
    p.screen(false);
    p.app.active = false;
    p.news({ state: 'stopped' });
    await p.flush();
    assert.strictEqual(p.M.now().playing, false);
    assert.strictEqual(p.M.now().native, false);
    assert.strictEqual(p.app.report, '');
    assert.strictEqual(p.store.get('wmNativePlayer'), undefined);
});

test('another program\'s report and stream are never cleared or stopped by Media', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(3), true);
    await p.flush();
    // another program reported since (the slot is shared): Media's pause says nothing, and 'handed' is not its
    p.app.bridge.watching('{"url":"x"}');
    p.store.set('wmNativeSlot', 'videos');
    const said = p.app.reports.length;
    p.news({ state: 'handed' });
    assert.strictEqual(p.M.now().native, false, '\'handed\' is about the other program\'s report');
    p.el().pause();
    await p.flush();
    assert.strictEqual(p.app.reports.length, said, 'no watching("") over it');
    assert.strictEqual(p.app.report, '{"url":"x"}');
    p.M.playPause();
    await p.flush();
    // Media has the player, then XM takes it: Media lets go without a word to the app
    p.app.take(0);
    p.news({ state: 'handed' });
    await p.flush();
    p.store.set('wmNativePlayer', 'xmradio');
    p.store.set('wmNativeSlot', 'xmradio');
    const n = p.app.reports.length;
    p.emit('wmnativeplayer', { owner: 'xmradio' });
    p.emit('wmphonesound', { by: 'xmradio' });
    p.news({ state: 'playing' });
    p.news({ state: 'stopped' });
    p.registered['windows-media'].onEnd();
    await p.flush();
    assert.strictEqual(p.M.now().native, false);
    assert.strictEqual(p.M.now().playing, false);
    assert.strictEqual(p.app.stops, 0);
    assert.strictEqual(p.app.reports.length, n);
});

test('the player holds something that is not a music queue (another window took it): never stopped by Media', async () => {
    const p = await mediaPage();
    p.M.enqueue(songs(3), true);
    await p.flush();
    p.app.take(0);
    p.news({ state: 'handed' });
    p.screen(false);
    await p.flush();
    p.app.musicNow = null; // the DeX window's video is on the player now: this window heard nothing
    p.screen(true);
    await p.flush();
    assert.strictEqual(p.app.stops, 0);
    assert.strictEqual(p.M.now().native, false);
    assert.strictEqual(p.M.now().playing, false, 'and nothing starts by itself');
});

test('a fresh page takes over the music the app still plays; Stop works', async () => {
    const log = [];
    const app = fakeApp(log);
    const store = new Map();
    const first = await mediaPage({ app, store, log });
    first.M.enqueue(songs(6), true);
    await first.flush();
    app.take(0); // the page is killed before it hears 'handed'
    app.musicNow = { index: 3, positionMs: 61000, playing: true };
    const said = app.reports.length;
    const p = await mediaPage({ app, store, log });
    assert.strictEqual(app.reports.length, said, 'opening says nothing to the app');
    assert.strictEqual(app.stops, 0, 'and stops nothing');
    const now = p.M.now();
    assert.strictEqual(now.title, 'Song 3');
    assert.strictEqual(now.playing, true);
    assert.strictEqual(now.native, true);
    assert.strictEqual(now.count, 6);
    assert.ok(!p.held.has('media-page'));
    p.registered['windows-media'].onEnd();
    await p.flush();
    assert.strictEqual(app.stops, 1);
    assert.strictEqual(p.M.now().playing, false);
});

test('a fresh page with nothing playing in the app drops the old note', async () => {
    const log = [];
    const app = fakeApp(log);
    const store = new Map([['wmMediaNative', JSON.stringify({ items: songs(2) })]]);
    const p = await mediaPage({ app, store, log });
    assert.strictEqual(p.M.now(), null);
    assert.strictEqual(store.get('wmMediaNative'), undefined);
    assert.strictEqual(app.reports.length, 0);
});

// ---------------------------------------------------------------- XM Radio beside it

function xmStore(extra) {
    return new Map([['userType', 'admin'], ['wmXmRadioCache', JSON.stringify({ lineup: { at: Date.now(), channels: [{ id: 'octane', number: 37, name: 'Octane' }, { id: 'hits1', number: 2, name: 'Hits' }] } })], ...(extra || [])]);
}
async function xmPage(app, store, log) {
    const page = fakePage({ app, store, log });
    page.run(SRC.xm, 'wmXmRadio.js');
    await page.flush();
    page.alarm = async (on) => { page.window.document.dispatchEvent(new CustomEvent('xmradio:alarm', { detail: { on, channelId: 'octane' } })); await page.flush(); };
    return page;
}

test('XM on the app\'s player: no hold, the screen off and Media\'s news change nothing', async () => {
    const log = [];
    const app = fakeApp(log);
    const p = await xmPage(app, xmStore(), log);
    await p.alarm(true);
    assert.strictEqual(app.active, true);
    assert.strictEqual(p.store.get('wmNativePlayer'), 'xmradio');
    assert.ok(!p.held.has('xmradio-page'));
    log.length = 0;
    p.screen(false);
    p.visibility(true);
    await p.flush();
    p.visibility(false);
    p.screen(true);
    await p.flush();
    assert.deepStrictEqual(log, [], 'nothing said to the app');
    // XM then loads Media's page code: it neither stops nor clears XM's stream on boot
    p.run(SRC.media, 'wmMedia.js');
    await p.flush();
    assert.deepStrictEqual(log, []);
    assert.strictEqual(app.active, true);
});

test('Media then XM on the app\'s player: each hears only its own news', async () => {
    const log = [];
    const app = fakeApp(log);
    const p = await xmPage(app, xmStore(), log);
    p.run(SRC.media, 'wmMedia.js');
    await p.flush();
    const M = p.window.wmMedia;
    M.enqueue(songs(3), true);
    await p.flush();
    app.take(0);
    p.news({ state: 'handed' });
    await p.flush();
    assert.strictEqual(M.now().native, true);
    p.news({ state: 'paused' });
    await p.flush();
    assert.strictEqual(p.programs.xmradio.describe(), null, 'Media\'s news is not the radio\'s');
    const stops = app.stops;
    await p.alarm(true); // the radio takes the player
    assert.strictEqual(M.now().native, false, 'Media let go');
    assert.strictEqual(app.stops, stops, 'without stopping the radio\'s stream');
    assert.ok(app.report.includes('/api/xmradio/live/octane'), 'and without clearing its report');
    p.news({ state: 'playing' });
    await p.flush();
    assert.strictEqual(p.programs.xmradio.describe().playing, true);
    // a song played in the page: the radio yields, stopping its own stream
    M.enqueue(songs(1), true);
    await p.flush();
    assert.strictEqual(app.stops, stops + 1);
    assert.strictEqual(p.programs.xmradio.describe(), null);
    assert.ok(lastReport(app).music, 'Media\'s report stands');
});

test('XM on a fresh page: takes over its own stream, never Media\'s queue', async () => {
    const saved = JSON.stringify({ channelId: 'octane', mode: 'live', url: `${ORIGIN}/api/xmradio/live/octane.m3u8`, at: Date.now() });
    const log = [];
    const mine = fakeApp(log);
    mine.active = true; mine.state_ = 'playing';
    const a = await xmPage(mine, xmStore([['wmXmRadioNative', saved], ['wmNativePlayer', 'xmradio']]), log);
    assert.strictEqual(a.programs.xmradio.describe().playing, true);
    assert.strictEqual(mine.stops, 0);
    const theirs = fakeApp(log);
    theirs.active = true; theirs.state_ = 'playing'; theirs.musicNow = { index: 0, positionMs: 0, playing: true };
    const b = await xmPage(theirs, xmStore([['wmXmRadioNative', saved]]), log);
    assert.strictEqual(b.programs.xmradio.describe(), null);
    assert.strictEqual(theirs.stops, 0);
    assert.strictEqual(theirs.reports.length, 0);
});

test('XM in the page\'s own player (no app player takes it): held awake while it is meant to play', async () => {
    const log = [];
    const app = fakeApp(log);
    app.bridge.handOff = () => false;
    const p = await xmPage(app, xmStore(), log);
    p.window.document.createElement = ((make) => (tag) => { const el = make(tag); if (tag === 'audio') el.canPlayType = () => 'maybe'; return el; })(p.window.document.createElement);
    await p.alarm(true);
    assert.ok(p.held.has('xmradio-page'), 'held');
    p.screen(false);
    p.visibility(true);
    await p.flush();
    assert.ok(p.held.has('xmradio-page'));
    assert.strictEqual(p.media[0].paused, false, 'screen off pauses nothing');
    p.media[0].dispatchEvent(new Event('waiting'));
    assert.ok(p.held.has('xmradio-page'), 'held while buffering');
    await p.alarm(false);
    assert.ok(!p.held.has('xmradio-page'), 'off: released');
});

// ---------------------------------------------------------------- Videos' shared-player functions, from the file

/** The source of `function name(...) {...}` in src. */
function fn(src, name) {
    const at = src.indexOf(`    function ${name}(`);
    assert.ok(at >= 0, `found: ${name}`);
    const end = src.indexOf('\n    }\n', at);
    const one = src.slice(at, src.indexOf('\n', at));
    return /\}\s*$/.test(one) && one.includes('{') ? one : src.slice(at, end + 7);
}
function videosEnv({ player, app, store, video, held }) {
    const src = SRC.videos;
    const head = src.slice(src.indexOf("    const ME = 'videos';"), src.indexOf('    /**\n     * Tells the app what the page\'s player shows'));
    const body = [head, "const canHand = (p) => p.state === 'live' && (!p.vod || p.kind === 'ytr');", "let plTold = null;", fn(src, 'plTell'), fn(src, 'plTakeBack'), fn(src, 'plAudible'), fn(src, 'plAwake')].join('\n');
    const window = { melatonContinuity: { holdAwake: (r, on) => held.push([r, on]) }, dispatchEvent() {} };
    const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    // eslint-disable-next-line no-new-func
    return new Function('window', 'localStorage', 'HOST', 'nativePlayer', 'player', 'els', 'shown', 'location', 'modeLabel', 'plAt', 'plNeedsTap', 'CustomEvent',
        `${body}\nreturn { plTell, plTakeBack, plAudible, plAwake };`)(window, localStorage, { desktop: false }, () => app.bridge, player, { video }, true, { origin: ORIGIN }, () => '', () => {}, () => {}, CustomEvent);
}

test('Videos: nothing to show never clears another program\'s report, a take-back never stops its stream', async () => {
    const log = [];
    const app = fakeApp(log);
    app.bridge.watching('{"url":"radio"}');
    app.active = true;
    const store = new Map([['wmNativeSlot', 'xmradio'], ['wmNativePlayer', 'xmradio']]);
    const player = { state: 'live', url: '', mode: '480' };
    const env = videosEnv({ player, app, store, video: { paused: true, ended: false }, held: [] });
    const said = app.reports.length;
    env.plTell();
    env.plTakeBack();
    assert.strictEqual(app.reports.length, said);
    assert.strictEqual(app.stops, 0);
});

test('Videos: a muted picture leaves another program\'s report in place; one with sound takes the slot', async () => {
    const app = fakeApp([]);
    app.bridge.watching('{"url":"music"}');
    const store = new Map([['wmNativeSlot', 'media']]);
    const player = { state: 'live', url: '/api/videos/live/1/index.m3u8', mode: '480' };
    const video = { paused: false, ended: false, muted: true, currentTime: 0 };
    const env = videosEnv({ player, app, store, video, held: [] });
    env.plTell();
    assert.strictEqual(app.report, '{"url":"music"}');
    video.muted = false;
    env.plTell();
    assert.ok(app.report.includes('/api/videos/live/1/'));
    assert.strictEqual(store.get('wmNativeSlot'), 'videos');
    video.paused = true;
    env.plTell();
    assert.strictEqual(app.report, '', 'its own report is cleared');
});

test('Videos: held awake for any kind that sounds in the page, not for silent or handed ones', async () => {
    const app = fakeApp([]);
    const cases = [
        [{ kind: 'yt', vod: true, paused: false, muted: false, sounding: true }, {}, true],
        [{ kind: 'yt', vod: true, paused: false, muted: true, sounding: true }, {}, false],
        [{ kind: 'ytr', vod: true, mode: 'v480', sounding: true }, { muted: false }, true],
        [{ mode: '480', sounding: true }, { muted: false }, true],
        [{ mode: '480', sounding: true }, { muted: true }, false],
        [{ mode: '480', sounding: false }, { muted: false }, false],
        [{ mode: 'audio', sounding: true, handed: true }, { muted: false }, false],
        [{ mode: '480', sounding: true, suspended: true }, { muted: false }, false]
    ];
    for (const [player, video, want] of cases) {
        const held = [];
        const env = videosEnv({ player, app, store: new Map(), video, held });
        env.plAwake();
        assert.deepStrictEqual(held, want ? [['videos-live', true]] : [], JSON.stringify(player));
    }
    // and the screen-off listener pauses only what is not heard
    const off = SRC.videos.slice(SRC.videos.indexOf("window.addEventListener('melatonscreen', () => {\n            const p = player;"));
    assert.ok(/if \(!p\.handed && !p\.popped && !plAudible\(\) && !\(nativePlayer\(\) && canHand\(p\)\)/.test(off.slice(0, 1400)));
});

test('all three programs load in one page and register, saying nothing to the app and stopping nothing', async () => {
    const log = [];
    const app = fakeApp(log);
    app.active = true; // something plays in the app as the page opens
    const p = fakePage({ app, store: xmStore(), log });
    p.run(SRC.videos, 'wmYouTube.js');
    p.run(SRC.xm, 'wmXmRadio.js');
    p.run(SRC.media, 'wmMedia.js');
    await p.flush();
    assert.deepStrictEqual(Object.keys(p.registered).sort(), ['windows-media', 'xmradio-mobile', 'youtube']);
    assert.deepStrictEqual(log, []);
});

test('the page\'s own media hold ignores music the app\'s player has', async () => {
    const body = SRC.continuity.slice(SRC.continuity.indexOf('    function mediaPlaying() {'), SRC.continuity.indexOf('     * A notification whose class repeats'));
    // eslint-disable-next-line no-new-func
    const make = new Function('root', `${body.slice(0, body.lastIndexOf('    /**'))}\nreturn mediaPlaying;`);
    assert.strictEqual(make({ wmMedia: { now: () => ({ playing: true, native: false }) } })(), true);
    assert.strictEqual(make({ wmMedia: { now: () => ({ playing: true, native: true }) } })(), false);
});

(async () => {
    let failed = 0;
    for (const t of tests) {
        try {
            await t.fn();
            console.log(`ok  ${t.name}`);
        } catch (err) {
            failed++;
            console.log(`FAIL ${t.name}\n     ${err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n     ') : err}`);
        }
    }
    console.log(failed ? `test-phone-playback-handoff: ${failed} of ${tests.length} failed` : `test-phone-playback-handoff: all ${tests.length} passed`);
    process.exit(failed ? 1 : 0);
})();
