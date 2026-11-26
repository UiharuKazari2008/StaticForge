#!/usr/bin/env node
/**
 * The rain card (Yozora #1267): weatherAlerts.js rainCardHtml / rainNowText / readRain and the rain alarm's notice,
 * run with a fake window and document. Offline.
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
function load(extra = {}) {
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
    const document = { documentElement: { classList: { contains: () => false } }, dispatchEvent() {}, addEventListener() {}, getElementById: () => null };
    vm.runInNewContext(SOURCE, { window: win, document, CustomEvent: class {}, Intl, Date, console });
    return { win, store, handlers, sent, wa: win.weatherAlerts };
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

    // the desktop: the rain alarm is the phone's notice, shown there only with Settings > Show on desktop
    const off = [];
    const quiet = load({ showGlassToast: (...a) => off.push(a) });
    quiet.handlers.weather_rain_alarm({ data: { place: { id: 'home', label: 'Home' }, kind: 'Rain', startsInMin: 5, current, series: series([0, 1]), seriesStep: 5 } });
    assert.strictEqual(off.length, 0, 'no desktop notice without Show on desktop');

    // the alarm's notice: sentence plus card, text only without a series, and no "in 0 min"
    const toasts = [];
    const page = load({ showGlassToast: (...a) => toasts.push(a) });
    page.store.set('wmWeatherSettings', JSON.stringify({ desktopRain: true }));
    page.handlers.weather_rain_alarm({ data: { place: { id: 'home', label: 'Home' }, kind: 'Rain', startsInMin: 0, endsInMin: 20, current, series: series([1, 1]), seriesStep: 5 } });
    page.handlers.weather_rain_alarm({ data: { place: { id: 'work', label: 'Work' }, kind: 'Rain', startsInMin: 1 } });
    assert.strictEqual(toasts[0][1], 'Rain at Home now');
    assert.ok(toasts[0][2].startsWith('Rain now, stopping after about 20 minutes.<div class="wx-rain-card">'));
    assert.ok(toasts[0][2].includes('<svg'));
    assert.strictEqual(toasts[1][1], 'Rain at Work in 1 min');
    assert.strictEqual(toasts[1][2], 'Rain from about 1 minute from now, lasting the rest of the hour.');
    // its own program's caption icon, never the window in front's; the screen's bottom right corner
    assert.strictEqual(JSON.stringify(toasts[0][7]), JSON.stringify({ appIcon: 'melaton-weather.png', position: 'bottom-right' }));
    // a provider summary that says it stays dry is never the text over a graph of rain (the Nov 26 notice)
    page.handlers.weather_rain_alarm({ data: { place: { id: 'here', label: 'Here' }, kind: 'Light rain', startsInMin: 12, endsInMin: null, summary: 'No precipitation for the next hour', current, series: series([0, 0, 0.2, 0.2]), seriesStep: 15 } });
    assert.ok(toasts[2][2].startsWith('Light rain from about 12 minutes from now, lasting the rest of the hour.'), toasts[2][2]);
    assert.ok(!toasts[2][2].includes('No precipitation'));

    // the desktop with only the stub: the program loads first, so the notice has its glyph
    const late = [];
    const desk = load({ showGlassToast: (...a) => late.push(a) });
    desk.store.set('wmWeatherSettings', JSON.stringify({ desktopRain: true }));
    desk.win.featureLoader = { loadFeature: async (name) => { assert.strictEqual(name, 'melaton_weather'); desk.win.wmWeather = { iconUrl, open() {} }; } };
    desk.handlers.weather_rain_alarm({ data: { place: { id: 'home', label: 'Home' }, startsInMin: 5, current, series: series([0, 1]), seriesStep: 5 } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(late[0][2].includes('/art/wx-rain.png') && late[0][2].includes('<svg'));

    console.log('weather rain card: ok');
})().catch((err) => { console.error(err); process.exit(1); });
