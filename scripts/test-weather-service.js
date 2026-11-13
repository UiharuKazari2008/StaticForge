#!/usr/bin/env node
/**
 * modules/weatherService.js (Yozora #780): Apple Weather normalisation from a WeatherKit-shaped
 * fixture, the cache (shared fetch, stale on failure, failure back-off), the rate limiter, .p8 keys
 * (pasted with the newlines lost), the service key status probe's parsing, and the alert monitor's
 * broadcast (new alerts once). Offline: no host is called.
 *
 *   node scripts/test-weather-service.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');

// the alert monitor's memory of broadcast alerts: a scratch file, never the live one
process.env.WEATHER_ALERTS_SEEN_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wx-seen-')), 'seen.json');
const ws = require('../modules/weatherService');
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

function appleFixture() {
    const day = (i) => new Date(Date.UTC(2026, 10, 13 + i, 5)).toISOString().replace('.000', '');
    return {
        currentWeather: {
            asOf: '2026-11-13T15:00:00Z', cloudCover: 0.42, conditionCode: 'Breezy', daylight: true, humidity: 0.55,
            precipitationIntensity: 0, pressure: 1012.4, pressureTrend: 'falling', temperature: 11.2, temperatureApparent: 9.1,
            temperatureDewPoint: 2.5, uvIndex: 3, visibility: 24000, windDirection: 290, windGust: 41, windSpeed: 26
        },
        forecastNextHour: {
            forecastStart: '2026-11-13T15:00:00Z', forecastEnd: '2026-11-13T16:00:00Z',
            summary: [
                { startTime: '2026-11-13T15:00:00Z', endTime: '2026-11-13T15:12:00Z', condition: 'clear', precipitationChance: 0, precipitationIntensity: 0 },
                { startTime: '2026-11-13T15:12:00Z', condition: 'precipitation', precipitationChance: 0.7, precipitationIntensity: 1.4 }
            ],
            minutes: Array.from({ length: 60 }, (_, i) => ({ startTime: new Date(Date.UTC(2026, 10, 13, 15, i)).toISOString().replace('.000', ''), precipitationChance: i < 12 ? 0 : 0.7, precipitationIntensity: i < 12 ? 0 : 1.4 }))
        },
        forecastHourly: {
            hours: Array.from({ length: 30 }, (_, i) => ({
                forecastStart: new Date(Date.UTC(2026, 10, 13, 12 + i)).toISOString().replace('.000', ''), cloudCover: 0.5, conditionCode: i % 5 ? 'PartlyCloudy' : 'Drizzle',
                daylight: i < 8, humidity: 0.6, precipitationAmount: 0.2, precipitationIntensity: 0.2, precipitationChance: 0.3, precipitationType: 'rain',
                pressure: 1011, pressureTrend: 'steady', snowfallAmount: 0, temperature: 8 + (i % 6), temperatureApparent: 6 + (i % 6), temperatureDewPoint: 2,
                uvIndex: i < 6 ? 2 : 0, visibility: 20000, windDirection: 280, windGust: 30, windSpeed: 18
            }))
        },
        forecastDaily: {
            days: Array.from({ length: 10 }, (_, i) => ({
                forecastStart: day(i), forecastEnd: day(i + 1), conditionCode: i === 1 ? 'HeavySnow' : 'MostlyCloudy', maxUvIndex: 3,
                moonPhase: 'waxingCrescent', moonrise: '2026-11-13T16:10:00Z', moonset: '2026-11-14T03:20:00Z',
                precipitationAmount: 3.2, precipitationChance: 0.6, precipitationType: 'rain', snowfallAmount: i === 1 ? 40 : 0,
                solarNoon: '2026-11-13T16:40:00Z', sunrise: '2026-11-13T11:40:00Z', sunriseCivil: '2026-11-13T11:10:00Z',
                sunset: '2026-11-13T21:40:00Z', sunsetCivil: '2026-11-13T22:10:00Z', temperatureMax: 13, temperatureMin: 4,
                windGustSpeedMax: 50, windSpeedAvg: 20, windSpeedMax: 32,
                daytimeForecast: { forecastStart: '2026-11-13T12:00:00Z', forecastEnd: '2026-11-14T00:00:00Z', cloudCover: 0.6, conditionCode: 'Rain', humidity: 0.7, precipitationAmount: 2, precipitationChance: 0.6, precipitationType: 'rain', temperatureMax: 13, windDirection: 270, windSpeed: 20 },
                overnightForecast: { forecastStart: '2026-11-14T00:00:00Z', forecastEnd: '2026-11-14T12:00:00Z', cloudCover: 0.9, conditionCode: 'Cloudy', humidity: 0.8, precipitationChance: 0.2, temperatureMin: 4, windDirection: 260, windSpeed: 12 }
            }))
        },
        weatherAlerts: {
            detailsUrl: 'https://weatherkit.apple.com/alertDetails/index.html',
            alerts: [{ id: '0a1b2c3d-1111-2222-3333-444455556666', areaName: 'Kings County', certainty: 'likely', countryCode: 'US', description: 'Wind Advisory', effectiveTime: '2026-11-13T14:00:00Z', expireTime: '2026-11-14T02:00:00Z', issuedTime: '2026-11-13T13:50:00Z', severity: 'moderate', source: 'National Weather Service', urgency: 'expected', detailsUrl: 'https://weatherkit.apple.com/alertDetails/x' }]
        }
    };
}

(async () => {
    await test('Apple reply -> model (wall clock, units, codes, parts, alerts)', () => {
        const m = T.normaliseApple(appleFixture(), 'America/New_York', { country: 'US' });
        assert.strictEqual(m.provider, 'apple');
        assert.strictEqual(m.attribution.name, 'Apple Weather');
        assert.strictEqual(m.current.time, '2026-11-13T10:00');
        assert.strictEqual(m.current.humidity, 55);
        assert.strictEqual(m.current.cloud, 42);
        assert.strictEqual(m.current.text, 'Breezy');
        assert.strictEqual(m.current.code, 1);
        assert.strictEqual(m.current.pressureTrend, 'falling');
        assert.strictEqual(m.hourly.length, 30);
        assert.strictEqual(m.hourly[0].time, '2026-11-13T07:00');
        assert.strictEqual(m.hourly[0].code, 53);
        assert.strictEqual(m.hourly[0].rain, 30);
        assert.strictEqual(m.daily.length, 10);
        assert.strictEqual(m.daily[0].date, '2026-11-13');
        assert.strictEqual(m.daily[1].code, 75);
        assert.strictEqual(m.daily[1].text, 'Heavy Snow');
        assert.strictEqual(m.daily[0].sunrise, '2026-11-13T06:40');
        assert.strictEqual(m.daily[0].dawn, '2026-11-13T06:10');
        assert.strictEqual(m.daily[0].day.code, 63);
        assert.strictEqual(m.daily[0].night.rain, 20);
        assert.strictEqual(m.daily[0].daylightSec, 36000);
        assert.ok(m.daily[0].feelsMaxC != null);
        assert.strictEqual(m.alerts.length, 1);
        assert.strictEqual(m.alerts[0].title, 'Wind Advisory');
        assert.strictEqual(m.alerts[0].expires, '2026-11-13T21:00');
        assert.strictEqual(m.alertsSource, 'Apple Weather');
        assert.strictEqual(m.minutely.minutes.length, 60);
        assert.strictEqual(m.minutely.summary, 'Rain starting in 12 min');
    });

    await test('every Apple condition maps to a WMO code', () => {
        ['Clear', 'MostlyCloudy', 'Haze', 'ScatteredThunderstorms', 'WintryMix', 'Blizzard', 'Tornado', 'SunFlurries'].forEach((c) => {
            const r = T.appleCondition(c);
            assert.ok(Number.isFinite(r.code), c);
        });
        assert.strictEqual(T.appleCondition('SomethingNew').text, 'Something New');
    });

    await test('cache: one fetch for concurrent asks, stale copy on failure, back-off', async () => {
        let calls = 0;
        let fail = false;
        const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); if (fail) throw new Error('down'); return { v: calls }; };
        const [a, b] = await Promise.all([T.memo('t:1', fn, { ttl: 1 }), T.memo('t:1', fn, { ttl: 1 })]);
        assert.strictEqual(calls, 1);
        assert.strictEqual(a, b);
        await new Promise((r) => setTimeout(r, 5));
        fail = true;
        const stale = await T.memo('t:1', fn, { ttl: 1, failTtl: 60000 });
        assert.strictEqual(stale.stale, true);
        assert.strictEqual(stale.v, 1);
        const again = await T.memo('t:1', fn, { ttl: 1, failTtl: 60000 });
        assert.strictEqual(calls, 2, 'no retry inside the back-off');
        assert.strictEqual(again.stale, true);
        await assert.rejects(T.memo('t:2', fn, { ttl: 1, noStale: true }), /down/);
        // a stale list stays a list
        fail = false;
        await T.memo('t:3', async () => [1, 2], { ttl: 1 });
        await new Promise((r) => setTimeout(r, 5));
        const list = await T.memo('t:3', async () => { throw new Error('down'); }, { ttl: 1, failTtl: 60000 });
        assert.ok(Array.isArray(list), 'stale list is an array');
    });

    await test('limiter: per-minute bucket and daily budget', () => {
        const l = new T.Limiter('X', { perMinute: 3, perDay: 5 });
        l.take(); l.take(); l.take();
        assert.throws(() => l.take(), (e) => e.code === 'RATE_LIMITED');
        l.tokens = 3;
        l.take(); l.take();
        assert.throws(() => l.take(), (e) => e.code === 'BUDGET_EXCEEDED');
        assert.strictEqual(l.stats().used, 5);
        l.pause(1000);
        assert.throws(() => l.take(), (e) => e.code === 'RATE_LIMITED');
    });

    await test('.p8 key pasted without newlines is rebuilt; RSA keys are refused', () => {
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
        const flat = pem.replace(/\n/g, '');
        const out = ws.normalisePrivateKey(flat);
        const tok = T.signAppleToken({ teamId: 'ABCDE12345', serviceId: 'com.x.w', keyId: 'KEY1234567', privateKey: out }).token;
        const [h, p, s] = tok.split('.');
        assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
        assert.deepStrictEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY1234567', id: 'ABCDE12345.com.x.w' });
        const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
        assert.throws(() => ws.normalisePrivateKey(rsa), /P-256/);
        assert.throws(() => ws.normalisePrivateKey('not a key!'), /not a .p8/);
    });

    await test('service key status probe: missing parts fail without a request', async () => {
        const r = await ws.testCredential('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\nTEAM\n');
        assert.strictEqual(r.state, 'fail');
    });

    await test('apiKeyManager: Apple Weather key with fields, fingerprint and status secret', () => {
        const ApiKeyManager = require('../modules/apiKeyManager');
        // the constructor's other jobs touch real files (the Claude token file, #781): not in a test
        ['importClaudeTokenFile', 'syncClaudeTokenFile', 'migrateTokenRouterManagementKeys'].forEach((k) => {
            if (typeof ApiKeyManager.prototype[k] === 'function') ApiKeyManager.prototype[k] = () => {};
        });
        const store = { secure: {}, config: { selectedApiKeys: {} } };
        const at = (obj, p) => p.reduce((o, k) => (o == null ? undefined : o[k]), obj);
        const modify = (which) => ({
            append: (p, v) => { let o = store[which]; p.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; }); (o[p[p.length - 1]] = o[p[p.length - 1]] || []).push(v); },
            replace: (p, i, v) => { at(store[which], p)[i] = v; },
            assign: () => {}, delete: () => {}
        });
        const gr = {
            getSecureConfig: ({ path: p }) => at(store.secure, Array.isArray(p) ? p : [p]),
            getConfig: ({ path: p }) => at(store.config, Array.isArray(p) ? p : [p]),
            modifyConfig: (t) => modify(t === 'secureConfig' ? 'secure' : 'config')
        };
        const m = new ApiKeyManager(gr);
        m.noteKeysChanged = () => {};
        const pem = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
        assert.throws(() => m.addApiKey('appleweather', 'Main', pem.replace(/\n/g, ''), { fields: { teamId: 'abcde12345', serviceId: 'com.x.w' } }), /Key ID is required/);
        const r = m.addApiKey('appleweather', 'Main', pem.replace(/\n/g, ''), { fields: { teamId: 'abcde12345', serviceId: 'com.x.w', keyId: 'key1234567' } });
        assert.strictEqual(r.key.fingerprint, 'Key KEY1234567');
        const key = m.getServiceKeys('appleweather')[0];
        assert.strictEqual(key.teamId, 'ABCDE12345');
        assert.ok(key.apiKey.includes('\n'), 'stored as a PEM with newlines');
        const secret = m.credentialSecret('appleweather', key);
        assert.strictEqual(secret.split('\n').pop(), 'KEY1234567');
        const summary = m.listServiceSummaries().find((x) => x.id === 'appleweather');
        assert.deepStrictEqual(summary.keys[0].fields, { teamId: 'ABCDE12345', serviceId: 'com.x.w', keyId: 'KEY1234567' });
        assert.strictEqual(summary.keyFileAccept, '.p8,.pem,.txt');
        m.updateApiKey('appleweather', 0, '', '', { fields: { serviceId: 'com.x.other' } });
        assert.strictEqual(m.getServiceKeys('appleweather')[0].serviceId, 'com.x.other');
        assert.strictEqual(m.getServiceKeys('appleweather')[0].keyId, 'KEY1234567');
    });

    await test('alert monitor: new alerts broadcast once, changes announced', async () => {
        const sent = [];
        const gr = {
            getConfig: () => undefined,
            getSecureConfig: ({ path: p }) => (p === 'location' ? { latitude: 40.71, longitude: -74.01 } : null),
            getApiKeyManager: () => null,
            getWebSocketServer: () => ({ broadcast: (msg) => sent.push(msg) })
        };
        ws.bind(gr);
        // a cached Open-Meteo forecast with one alert attached (no host is asked)
        const om = T.normaliseOpenMeteo({ timezone: 'America/New_York', utc_offset_seconds: -18000, current: { time: '2026-11-13T10:00', temperature_2m: 10, weather_code: 3, is_day: 1 }, hourly: { time: [] }, daily: { time: [] } });
        T.jsonCache.set('om:fc:40.71:-74.01', { ok: true, value: om, at: Date.now(), expires: Date.now() + 60000 });
        T.jsonCache.set('geo:country:40.7:-74', { ok: true, value: { code: 'US', city: 'New York', region: 'New York', country: 'United States' }, at: Date.now(), expires: Date.now() + 60000 });
        const alert = { id: `test-${Date.now()}`, title: 'Coastal Flood Advisory', severity: 'moderate', expires: '2099-01-01T00:00', provider: 'nws' };
        T.jsonCache.set('nws:alerts:40.71:-74.01', { ok: true, value: [alert], at: Date.now(), expires: Date.now() + 60000 });
        const first = await ws.pollAlerts();
        assert.strictEqual(first.alerts.length, 1);
        assert.strictEqual(sent.filter((m) => m.type === 'weather_alert_issued').length, 1);
        assert.strictEqual(sent.filter((m) => m.type === 'weather_alerts_changed').length, 1);
        await ws.pollAlerts();
        assert.strictEqual(sent.filter((m) => m.type === 'weather_alert_issued').length, 1, 'not again');
        assert.strictEqual(sent[0].data.place.label, 'Home');
    });

    await test('rain alarm: once per spell, when rain is due inside the lead time', async () => {
        const sent = [];
        const cfg = { weather: { places: { home: { name: 'Home', lat: 40.71, lon: -74.01, rainAlarm: true, rainLeadMin: 15 }, work: { name: 'Office', lat: 40.75, lon: -73.98, rainAlarm: false } } } };
        const gr = {
            getConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg),
            getSecureConfig: () => null,
            getApiKeyManager: () => null,
            getWebSocketServer: () => ({ broadcast: (msg) => sent.push(msg) })
        };
        // a fresh module copy so the bind and the monitor state are this test's
        delete require.cache[require.resolve('../modules/weatherService')];
        const w = require('../modules/weatherService');
        w.bind(gr);
        const tz = 'America/New_York';
        const t0 = Date.now();
        const minutes = Array.from({ length: 60 }, (_, i) => ({ time: w._test.localIso(t0 + i * 60000, tz), rain: i >= 10 ? 70 : 0, mmh: i >= 10 ? 1.5 : 0 }));
        const fc = { provider: 'openmeteo', tz, offset: -18000, current: { tempC: 10 }, hourly: [], daily: [], alerts: [], alertsSource: 'none', minutely: { stepMinutes: 1, summary: 'Rain starting in 10 min', minutes } };
        ['40.71:-74.01', '40.75:-73.98'].forEach((k) => w._test.jsonCache.set(`om:fc:${k}`, { ok: true, value: fc, at: Date.now(), expires: Date.now() + 60000 }));
        await w.pollPlaces();
        const alarms = sent.filter((m) => m.type === 'weather_rain_alarm');
        assert.strictEqual(alarms.length, 1, 'Home only (Work has the alarm off)');
        assert.strictEqual(alarms[0].data.place.id, 'home');
        assert.strictEqual(alarms[0].data.startsInMin, 10);
        assert.strictEqual(alarms[0].data.kind, 'Rain');
        await w.pollPlaces();
        assert.strictEqual(sent.filter((m) => m.type === 'weather_rain_alarm').length, 1, 'not again in the same spell');
        assert.ok(sent.some((m) => m.type === 'weather_rain_status'));
        const near = w.placeFor(40.712, -74.006);
        assert.strictEqual(near && near.id, 'home', 'a point inside Home\'s radius is Home');
        assert.strictEqual(w.placeFor(41.5, -74.0), null);
    });

    await test('a setting on the stand-in Home keeps its coordinates and saves it', async () => {
        const cfg = { weather: {} };
        const writes = [];
        const gr = {
            getConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg),
            getSecureConfig: ({ path: p }) => (p === 'location' ? { latitude: 38.28, longitude: -76.5 } : null),
            getApiKeyManager: () => null,
            getWebSocketServer: () => ({ broadcast: () => {} }),
            modifyConfig: () => ({ assign: (path, value) => { writes.push(value); cfg.weather = value; } })
        };
        delete require.cache[require.resolve('../modules/weatherService')];
        const w = require('../modules/weatherService');
        w.bind(gr);
        assert.strictEqual(w.getPlaces().home.fallback, true);
        const places = await w.savePlaces({ home: { rainAlarm: true } });
        assert.strictEqual(places.home.rainAlarm, true);
        assert.strictEqual(places.home.lat, 38.28);
        assert.ok(!places.home.fallback, 'saved as a real Home now');
        assert.strictEqual(writes.length, 1);
    });

    console.log(failures ? `\n${failures} failed` : '\nall passed');
    process.exit(failures ? 1 : 0);
})();
