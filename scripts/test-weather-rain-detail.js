#!/usr/bin/env node
/**
 * The rain popup's data and the daily weather picture brief (Yozora #1267): rainDetail's bucketing, cap and
 * icon ids, rainOutlook on past points, getRainStatus / alarm broadcast / readRainDetail, the monitor not
 * renewing the graph on every poll, the portable rain popup with and without detail, and a brief with no
 * readings in it. Offline: no host is called.
 *
 *   node scripts/test-weather-rain-detail.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.WEATHER_ALERTS_SEEN_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wx-seen-')), 'seen.json');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
const ws = require('../modules/weatherService');
const weatherDaily = require('../modules/weatherDaily');
require('../public/scripts/tasks/status-popups.js');
const popups = globalThis.CafeTasks.lib.statusPopups;
const T = ws._test;

let failures = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log(`ok   ${name}`);
    } catch (error) {
        failures++;
        console.log(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 3).join('\n     ')}`);
    }
}

const TZ = 'America/New_York';
const NOW = Date.UTC(2026, 10, 26, 15, 7, 30); // 10:07 at the place
const at = (min) => T.localIso(NOW + min * 60000, TZ);

function fineForecast(from = -10, count = 90, wetFrom = 10) {
    return {
        tz: TZ,
        current: { tempC: 18.04, text: 'Light Rain', code: 61, isDay: true },
        minutely: { stepMinutes: 1, summary: 's', minutes: Array.from({ length: count }, (_, i) => ({ time: at(from + i), rain: from + i >= wetFrom ? 70 : 0, mmh: from + i >= wetFrom ? 1.234567 : 0 })) }
    };
}

(async () => {
    await test('rainDetail: the next hour of 1-minute data in 15 buckets, highest per bucket', () => {
        const d = ws.rainDetail(fineForecast(), NOW);
        assert.strictEqual(d.seriesStep, 4);
        assert.strictEqual(d.series.length, 15);
        assert.strictEqual(d.series[0].t, '2026-11-26T10:07', 'past minutes are cut');
        assert.strictEqual(d.series[14].t, '2026-11-26T11:03');
        assert.deepStrictEqual(d.series[2], { t: '2026-11-26T10:15', mmh: 1.23, rain: 70 }, 'minutes 8 to 11 hold wet ones');
        assert.deepStrictEqual(d.series[1], { t: '2026-11-26T10:11', mmh: 0, rain: 0 });
        assert.deepStrictEqual(d.current, { tempC: 18, text: 'Light Rain', isDay: true, icon: 'rain' });
    });

    await test('rainDetail: 15-minute data keeps its step, from the running quarter, at most 16 points', () => {
        const base = Date.parse('2026-11-26T09:45Z');
        const minutes = Array.from({ length: 30 }, (_, i) => ({ time: new Date(base + i * 900000).toISOString().slice(0, 16), rain: null, mmh: i }));
        const d = ws.rainDetail({ tz: TZ, minutely: { stepMinutes: 15, minutes } }, NOW);
        assert.strictEqual(d.seriesStep, 15);
        assert.strictEqual(d.series.length, 16);
        assert.strictEqual(d.series[0].t, '2026-11-26T10:00', 'the quarter running at 10:07');
        assert.strictEqual(d.series[0].rain, null);
        assert.strictEqual(d.current, null);
        const later = ws.rainDetail({ tz: TZ, minutely: { stepMinutes: 15, minutes } }, NOW + 15 * 60000);
        assert.strictEqual(later.series[0].t, '2026-11-26T10:15');
        assert.deepStrictEqual(ws.rainDetail({ tz: TZ }, NOW), { current: null, series: [], seriesStep: 1 });
    });

    await test('rainOutlook: a cached forecast\'s past points are not rain now', () => {
        const minutes = [{ time: '2026-11-26T09:30', mmh: 3 }, { time: '2026-11-26T10:00', mmh: 0 }, { time: '2026-11-26T10:15', mmh: 2 }];
        const r = T.rainOutlook({ tz: TZ, minutely: { stepMinutes: 15, minutes } }, NOW);
        assert.strictEqual(r.wet, false);
        assert.strictEqual(r.startsInMin, 15);
        assert.strictEqual(T.rainOutlook({ tz: TZ, minutely: { stepMinutes: 15, minutes: minutes.slice(0, 1) } }, NOW), null, 'all past');
    });

    await test('icon ids match the Weather app\'s condition table', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'comp', 'wmWeather.js'), 'utf8');
        const start = src.indexOf('function condition(code');
        const body = src.slice(start, src.indexOf('\n    }\n', start) + 6);
        const condition = new Function(`${body}; return condition;`)();
        [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99, 42].forEach((c) => {
            [true, false].forEach((day) => assert.strictEqual(T.conditionIcon(c, day), condition(c, day).icon, `code ${c} day ${day}`));
        });
    });

    await test('monitor: detail only for a due place with the alarm on; alarm and readRainDetail carry it; no renewal per poll', async () => {
        const sent = [];
        const cfg = { weather: { places: { home: { name: 'Home', lat: 40.71, lon: -74.01, rainAlarm: true, rainLeadMin: 15 }, work: { name: 'Office', lat: 40.75, lon: -73.98, rainAlarm: false } } } };
        const gr = {
            getConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg),
            getSecureConfig: () => null,
            getApiKeyManager: () => null,
            getWebSocketServer: () => ({ broadcast: (msg) => sent.push(msg) })
        };
        delete require.cache[require.resolve('../modules/weatherService')];
        const w = require('../modules/weatherService');
        w.bind(gr);
        const t0 = Date.now();
        const mk = (temp) => ({ provider: 'openmeteo', tz: TZ, offset: -18000, current: { tempC: temp, text: 'Cloudy', code: 3, isDay: false }, hourly: [], daily: [], alerts: [], alertsSource: 'none',
            minutely: { stepMinutes: 1, summary: 'Rain', minutes: Array.from({ length: 90 }, (_, i) => ({ time: w._test.localIso(t0 + (i - 1) * 60000, TZ), rain: 80, mmh: 1.5 })) } });
        const put = (fc) => ['40.71:-74.01', '40.75:-73.98'].forEach((k) => w._test.jsonCache.set(`om:fc:${k}`, { ok: true, value: fc, at: Date.now(), expires: Date.now() + 60000 }));
        put(mk(10));
        await w.pollPlaces();
        const status = w.getRainStatus().places;
        assert.ok(status.home.series.length > 0 && status.home.series.length <= 16);
        assert.strictEqual(status.home.current.icon, 'cloudy');
        assert.ok(!('series' in status.work) && !('current' in status.work), 'Work has the alarm off');
        assert.deepStrictEqual(['lat', 'lon', 'tz'].filter((k) => status.home.place[k] != null), ['lat', 'lon', 'tz']);
        const pushes = () => sent.filter((m) => m.type === 'weather_rain_status').length;
        const before = pushes();
        const held = JSON.stringify(w.getRainStatus().places.home.series);
        put(mk(11));
        await w.pollPlaces();
        assert.strictEqual(pushes(), before, 'same outlook inside the quarter hour: no push');
        assert.strictEqual(w.getRainStatus().places.home.current.tempC, 10);
        assert.strictEqual(JSON.stringify(w.getRainStatus().places.home.series), held);
        w._test.monitor.rain.home.detailAt -= 15 * 60000;
        await w.pollPlaces();
        assert.strictEqual(pushes(), before + 1, 'renewed after a quarter hour');
        assert.strictEqual(w.getRainStatus().places.home.current.tempC, 11);
        const read = await w.readRainDetail('work');
        assert.strictEqual(read.id, 'work');
        assert.strictEqual(read.wet, true);
        assert.ok(read.series.length > 0, 'the series whether or not the alarm is on');
        assert.strictEqual(await w.readRainDetail('here'), null);
        assert.strictEqual(await w.readRainDetail('__proto__'), null);

        // the alarm broadcast: dry now, rain in ten minutes
        delete require.cache[require.resolve('../modules/weatherService')];
        const a = require('../modules/weatherService');
        a.bind(gr);
        const fc = mk(12);
        fc.minutely.minutes.forEach((m, i) => { if (i < 11) { m.mmh = 0; m.rain = 0; } });
        ['40.71:-74.01', '40.75:-73.98'].forEach((k) => a._test.jsonCache.set(`om:fc:${k}`, { ok: true, value: fc, at: Date.now(), expires: Date.now() + 60000 }));
        sent.length = 0;
        await a.pollPlaces();
        const alarm = sent.find((m) => m.type === 'weather_rain_alarm');
        assert.ok(alarm && alarm.data.current && alarm.data.series.length && alarm.data.seriesStep === 4);
    });

    await test('rain popup: text lines alone without detail; current, next hour and graph data with it', () => {
        const plain = popups.build('rain', { weather: { rain: true, rainLines: ['Rain at Home in about 10 min.'] } }, {});
        assert.ok(!('rain' in plain));
        assert.deepStrictEqual(plain.sec.map((s) => s.t), ['text', 'links']);
        const series = [{ t: '2026-11-26T12:00', mmh: 0, rain: 0 }, { t: '2026-11-26T12:04', mmh: 2, rain: 80 }, { t: '2026-11-26T12:08', mmh: 0, rain: 0 }];
        const one = { id: 'home', name: 'Home', tempC: 17.6, text: 'Light Rain', isDay: true, icon: 'rain', series, seriesStep: 4 };
        const p = popups.build('rain', { weather: { rain: true, rainLines: ['Rain at Home in about 4 min.'], rainDetail: [one] } }, {});
        assert.deepStrictEqual(p.sec.filter((s) => s.t === 'text').map((s) => s.s), ['Rain at Home in about 4 min.', 'Now 18 C / 64 F, Light Rain', 'Dry again from about 12:08 PM.']);
        assert.deepStrictEqual(p.rain, [{ name: 'Home', icon: 'rain', tempC: 17.6, text: 'Light Rain', isDay: true, series, seriesStep: 4 }]);
        assert.ok(p.sec.every((s) => ['text', 'links'].includes(s.t)), 'no new section type');
        const two = popups.build('rain', { weather: { rainDetail: [one, Object.assign({}, one, { name: 'Work', series: series.slice(1, 2) })] } }, {});
        const lines = two.sec.filter((s) => s.t === 'text').map((s) => s.s);
        assert.ok(lines.includes('Home now 18 C / 64 F, Light Rain') && lines.includes('Work: Wet through the next hour.'));
    });

    await test('daily picture brief: no readings, the three dg tokens and the dynamicGeneration call', () => {
        const place = { workspace: 'garden', name: 'Setagaya', lat: 35.65, lon: 139.65 };
        const fc = { offset: 32400, current: { text: 'Cloudy', tempC: 4.3, feelsC: 1.2, cloud: 92, windKmh: 14, humidity: 85, visibilityM: 3200, isDay: true },
            daily: [{ text: 'Rain', maxC: 7, minC: 2, rain: 80, sunrise: '2026-11-26T06:24', sunset: '2026-11-26T16:29' }] };
        for (const forecast of [fc, null]) {
            const brief = weatherDaily.briefFor(place, forecast, new Date(NOW)) + `\n${weatherDaily.NO_FORECAST_NOTE}`;
            const location = 'location: "139.65_35.65"';
            assert.ok(brief.includes(location), 'longitude first');
            assert.ok(!/\d/.test(brief.replace(location, '')), `digits in: ${brief}`);
            assert.ok(brief.includes('!dg_time, !dg_season, !dg_weather'));
            assert.ok(brief.includes('dynamicGeneration: { enabled: true, tod: true, weather: true, season: true, location:'));
            assert.ok(brief.includes('generate_image with workspace "garden"'));
        }
        const words = weatherDaily.briefFor(place, fc, new Date(NOW));
        assert.ok(/cold, overcast, light wind, humid, poor visibility, daylight, rain over the day, rain likely later/.test(words), words);
        const unnamed = weatherDaily.briefFor(Object.assign({}, place, { name: '' }), fc, new Date(NOW));
        assert.ok(unnamed.includes('Prompt shape (you may enrich the scenery of the place itself): landscape, !dg_time'));
        assert.strictEqual(unnamed.split('139.65').length, 2, 'coordinates only in the location argument');
    });

    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
