#!/usr/bin/env node
/**
 * The rain card (Yozora #1267): weatherAlerts.js rainCardHtml / rainNowText / readRain, and that the page raises NO
 * note, toast or message box for the rain alarm (#1337: the server's inbox notice is its one display), run with a fake
 * window and document. Offline.
 *
 *   node scripts/test-weather-rain-card.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'comp', 'weatherAlerts.js'), 'utf8');

/** weatherAlerts.js in its own fake page. */
function load(extra = {}, phone = false) {
    const events = [];
    const store = new Map();
    const handlers = {};
    const sent = [];
    const win = Object.assign({
        navigator: { language: 'en-GB' },
        localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) },
        addEventListener() {},
        wsClient: {
            on: (type, fn) => { handlers[type] = fn; },
            sendMessage: (type, data) => { sent.push({ type, data }); return Promise.resolve(win.reply); }
        }
    }, extra);
    if (phone) win.uiShell = 'mobile';
    const document = { documentElement: { classList: { contains: () => phone } }, dispatchEvent: (e) => events.push(e), addEventListener() {}, getElementById: () => null };
    vm.runInNewContext(SOURCE, { window: win, document, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }, Intl, Date, console });
    return { win, store, handlers, sent, events, wa: win.weatherAlerts };
}

const series = (mmh) => mmh.map((v, i) => ({ t: `2026-11-26T12:${String(i * 5).padStart(2, '0')}`, mmh: v, rain: i % 2 ? 80 : null }));
const current = { tempC: 18.4, text: 'Light Rain', isDay: true, icon: 'rain' };
// Melaton Weather's art helper, as wmWeather.iconUrl names its files
const iconUrl = (key, hd) => `/art/wx-${key}${hd ? '@2x' : ''}.png`;
const bars = (html) => (html.match(/<rect /g) || []).length;

(async () => {
    const { wa, win, store, handlers, sent } = load({ wmWeather: { iconUrl } });

    // a wet hour: one bar for each wet point, none for the dry ones, no sentence
    const wet = wa.rainCardHtml({ current, series: series([0, 0, 0.04, 0.05, 0.5, 1.2, 4.5, 8, 2, 0.3, 0, 0]), seriesStep: 5 });
    assert.strictEqual(bars(wet), 7);
    assert.ok(wet.includes('<svg ') && wet.includes('Now') && wet.includes('>1 h</text>'));
    assert.ok(!wet.includes('No precipitation'));
    assert.ok(wet.includes('wx-rain.png') && wet.includes('width="32" height="32"'));
    assert.ok(wet.includes('18\u00b0C') && wet.includes('Light Rain'));
    assert.ok(!/ style=|data:|<canvas|#[0-9a-f]{3,6}\b|font-family/i.test(wet));

    // dry: a sentence, no chart
    const dry = wa.rainCardHtml({ current, series: series([0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0]), seriesStep: 5 });
    assert.ok(dry.includes('No precipitation for the next hour'));
    assert.ok(!dry.includes('<svg'));

    // nothing to show, and a push without a series is the weather line alone
    assert.strictEqual(wa.rainCardHtml({}), '');
    assert.strictEqual(wa.rainCardHtml(null), '');
    assert.ok(!wa.rainCardHtml({ current }).includes('<svg'));

    // escaping, and an icon name that is not the art's is left out
    const bad = wa.rainCardHtml({ current: { tempC: 1, text: '<img src=x onerror=alert(1)> "q"', icon: '../x" onerror="y' } });
    assert.ok(bad.includes('&lt;img src=x onerror=alert(1)&gt; &quot;q&quot;'));
    assert.ok(!bad.includes('<img'));

    // unit: the picked one, then the language, then wmWeather's own answer
    assert.strictEqual(wa.rainNowText({ current }), 'Now: 18\u00b0C, Light Rain');
    store.set('wmWeatherUnit', '"F"');
    assert.strictEqual(wa.rainNowText({ current }), 'Now: 65\u00b0F, Light Rain');
    store.delete('wmWeatherUnit');
    win.navigator.language = 'en-US';
    assert.ok(wa.rainCardHtml({ current }).includes('65\u00b0F'));
    win.wmWeather = { iconUrl, unit: () => 'C' };
    assert.ok(wa.rainCardHtml({ current }).includes('18\u00b0C'));
    // no temperature is no number
    assert.strictEqual(wa.rainNowText({ current: { tempC: null, text: 'Cloudy' } }), 'Now: Cloudy');

    // the held weather of a place comes from the status push, which replaces it
    assert.strictEqual(wa.rainNowText('home'), '');
    handlers.weather_rain_status({ data: { places: { home: { current } } } });
    assert.strictEqual(wa.rainNowText('home'), 'Now: 18\u00b0C, Light Rain');
    const asked = () => sent.filter((m) => m.type === 'weather_rain_status');
    assert.strictEqual(asked().length, 0, 'held weather asks nothing');
    handlers.weather_rain_status({ data: { places: { work: { wet: false } } } });
    assert.strictEqual(wa.rainNowText('home'), '');

    // readRain: one request for the place; an empty reply or a failure is null
    win.reply = { data: { id: 'here', current, series: series([1]), seriesStep: 5 } };
    assert.strictEqual((await wa.readRain('here')).id, 'here');
    assert.strictEqual(JSON.stringify(asked()), JSON.stringify([{ type: 'weather_rain_status', data: { place: 'here' } }]));
    win.reply = {};
    assert.strictEqual(await wa.readRain('home'), null);
    win.wsClient.sendMessage = () => Promise.reject(new Error('offline'));
    assert.strictEqual(await wa.readRain('home'), null);

    // the rain alarm raises no note of its own, on a desktop client or on a phone (#1337): the server's inbox notice is its
    // one display. No toast (a toast with a button was a parentless message box), no appNote, no notify, no program load.
    const alarm = (id, label) => ({ data: { place: { id, label }, kind: 'Rain', startsInMin: 0, endsInMin: 20, current, series: series([0, 1, 2]), seriesStep: 5 } });
    for (const phone of [false, true]) {
        const shownNotes = [];
        const grab = (name) => (...a) => { shownNotes.push([name, a]); return { close() {}, update() {} }; };
        const page = load({
            showGlassToast: grab('showGlassToast'),
            wmShell: { appNote: grab('appNote'), notify: grab('notify') },
            featureLoader: { loadFeature: grab('loadFeature') },
            wmNotificationInbox: { shownBy: grab('shownBy'), clear: grab('clear'), acted: grab('acted') }
        }, phone);
        // even a leftover Show on desktop choice shows nothing
        page.store.set('wmWeatherSettings', JSON.stringify({ desktopRain: true }));
        page.handlers.weather_rain_alarm(alarm('home', 'Home'));
        page.handlers.weather_rain_alarm(alarm('home', 'Home')); // the same spell again (a re-push): still nothing, one event
        page.handlers.weather_rain_alarm(alarm('work', 'Work'));
        await new Promise((resolve) => setImmediate(resolve));
        assert.strictEqual(shownNotes.length, 0, `no page notice (${phone ? 'phone' : 'desktop'}): ${JSON.stringify(shownNotes.map((x) => x[0]))}`);
        // what stays: the weatherRainAlarm event once per spell, and the place's last read for the card
        assert.deepStrictEqual(page.events.map((e) => [e.type, e.detail.place.id]), [['weatherRainAlarm', 'home'], ['weatherRainAlarm', 'work']]);
        assert.strictEqual(page.wa.rainNowText('home'), 'Now: 18\u00b0C, Light Rain');
        assert.strictEqual(page.win.wmWeather, undefined, 'the alarm does not load the Weather program');
    }
    // nothing of the removed desktop choice is left on the Weather program's accessor
    assert.ok(!/desktopRain/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'comp', 'wmWeather.js'), 'utf8')), 'wmWeather.js has no desktopRain');
    assert.ok(!/showGlassToast|appNote|desktopRainWanted/.test(SOURCE.slice(SOURCE.indexOf('function onRain('), SOURCE.indexOf('let sentHere'))), 'onRain has no display call');

    console.log('weather rain card: ok');
})().catch((err) => { console.error(err); process.exit(1); });
