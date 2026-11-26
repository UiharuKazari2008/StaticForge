#!/usr/bin/env node
/**
 * Weather alert window and place wording (Yozora #1200): startsAt / endsAt on mapped alerts (raw instants),
 * placeTag's tz, alertWindowText and alertWhereText. Offline.
 *
 *   node scripts/test-weather-alert-times.js
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
const T = ws._test;

// instantMs: first parsable instant, zone honoured
assert.strictEqual(T.instantMs(null, '', 'nope', '2026-11-25T09:00:00Z'), Date.parse('2026-11-25T09:00:00Z'));
assert.strictEqual(T.instantMs(undefined, 'x'), null);
assert.strictEqual(T.instantMs('2026-11-25T18:00:00+09:00'), Date.parse('2026-11-25T09:00:00Z'));

// Apple shape through the mapper
const apple = T.normaliseApple({
    weatherAlerts: { detailsUrl: 'u', alerts: [
        { id: 'a1', description: 'Heavy rain', areaName: 'Setagaya', severity: 'severe', issuedTime: '2026-11-25T01:00:00Z', effectiveTime: '2026-11-25T02:00:00Z', eventOnsetTime: '2026-11-25T09:00:00Z', expireTime: '2026-11-26T00:00:00Z', eventEndTime: '2026-11-26T00:30:00Z' },
        { id: 'a2', description: 'Wind', issuedTime: '2026-11-25T01:00:00Z', expireTime: '2026-11-26T00:00:00Z' },
        { id: 'a3', description: 'Odd' }
    ] }
}, 'Asia/Tokyo', { country: 'JP' });
assert.ok(apple && apple.alerts && apple.alerts.length === 3);
{
    const [a1, a2, a3] = apple.alerts;
    assert.strictEqual(a1.startsAt, Date.parse('2026-11-25T09:00:00Z'));
    assert.strictEqual(a1.endsAt, Date.parse('2026-11-26T00:30:00Z'));
    assert.strictEqual(a2.startsAt, Date.parse('2026-11-25T01:00:00Z'));
    assert.strictEqual(a2.endsAt, Date.parse('2026-11-26T00:00:00Z'));
    assert.strictEqual(a3.startsAt, null);
    assert.strictEqual(a3.endsAt, null);
    assert.ok(a1.onset && a1.ends, 'existing localIso fields stay');
}

// placeTag carries the zone
assert.strictEqual(T.placeTag('home', { name: 'Setagaya', lat: 35.6, lon: 139.6 }, 'Asia/Tokyo').tz, 'Asia/Tokyo');
assert.strictEqual(typeof T.placeTag('home', { name: 'X', lat: 35.6, lon: 139.6 }).tz, 'string');

// window wording. now = Wed 25 Nov 2026 12:00 in Tokyo (03:00Z)
const now = Date.parse('2026-11-25T03:00:00Z');
const jp = { tz: 'Asia/Tokyo', now };
const at = (iso) => Date.parse(iso);
assert.strictEqual(ws.alertWindowText({ startsAt: at('2026-11-25T09:00:00Z'), endsAt: at('2026-11-26T00:00:00Z') }, jp), 'From today 6:00 PM until tomorrow 9:00 AM');
assert.strictEqual(ws.alertWindowText({ startsAt: at('2026-11-25T01:00:00Z'), endsAt: at('2026-11-26T00:00:00Z') }, jp), 'Until tomorrow 9:00 AM');
assert.strictEqual(ws.alertWindowText({ startsAt: null, endsAt: at('2026-11-26T00:00:00Z') }, jp), 'Until tomorrow 9:00 AM');
assert.strictEqual(ws.alertWindowText({ startsAt: at('2026-11-27T09:00:00Z') }, jp), 'From Fri 6:00 PM');
assert.strictEqual(ws.alertWindowText({ startsAt: at('2026-11-25T01:00:00Z') }, jp), '');
assert.strictEqual(ws.alertWindowText({}, jp), '');
assert.strictEqual(ws.alertWindowText({ startsAt: at('2026-12-03T09:00:00Z') }, jp), 'From Thu 3 Dec 6:00 PM');
assert.strictEqual(ws.alertWindowText({ startsAt: at('2026-11-20T00:00:00Z'), endsAt: at('2026-11-25T01:30:00Z') }, jp), 'Ended today 10:30 AM');
assert.strictEqual(ws.alertWindowText({ endsAt: at('2026-11-24T10:00:00Z') }, jp), 'Ended yesterday 7:00 PM');
// the day word follows the place's zone, not the server's: 02:00Z on the 26th is still the 25th evening in Chicago? (20:00 CST on the 25th)
const us = { tz: 'America/Chicago', now: at('2026-11-25T18:00:00Z') }; // 12:00 CST Wed
assert.strictEqual(ws.alertWindowText({ startsAt: at('2026-11-26T02:00:00Z'), endsAt: at('2026-11-26T15:00:00Z') }, us), 'From today 8:00 PM until tomorrow 9:00 AM');
assert.strictEqual(ws.alertWindowText({ endsAt: at('2026-11-26T15:00:00Z') }, us), 'Until tomorrow 9:00 AM');
// bad zone falls back to UTC, never throws
assert.doesNotThrow(() => ws.alertWindowText({ endsAt: at('2026-11-26T15:00:00Z') }, { tz: 'Not/AZone', now }));

// where wording
assert.strictEqual(ws.alertWhereText({ area: '' }, { label: 'Home', name: 'Setagaya' }), 'Home (Setagaya)');
assert.strictEqual(ws.alertWhereText({ area: '' }, { label: 'Home', name: '' }), 'Home');
assert.strictEqual(ws.alertWhereText({ area: '' }, { label: 'Home', name: 'Home' }), 'Home');
assert.strictEqual(ws.alertWhereText({ area: 'Tokyo Metropolis' }, { label: 'Home', name: 'Setagaya' }), 'Home (Setagaya) - Tokyo Metropolis');
assert.strictEqual(ws.alertWhereText({ area: 'Setagaya' }, { label: 'Home', name: 'Setagaya' }), 'Home (Setagaya)');
assert.strictEqual(ws.alertWhereText({ area: 'x'.repeat(61) }, { label: 'Work', name: 'Shibuya' }), 'Work (Shibuya)');
assert.strictEqual(ws.alertWhereText({ area: 'Cook County' }, null), 'Cook County');
assert.strictEqual(ws.alertWhereText({}, null), '');

console.log('weather alert times: ok');
