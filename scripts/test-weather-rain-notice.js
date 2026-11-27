#!/usr/bin/env node
/**
 * The rain alarm has ONE display (Yozora #1337): the server's inbox notice rain:<placeId>. Offline, silent.
 *   - the server: one notice per spell under rain:<placeId>, a second publish of the same spell is the same row (never a
 *     second display), the notice carries the card's data (data.detail), the #1267 wording ("now", never "in 0 min")
 *   - the page: wmNotificationInbox.show draws the note once for it, with the weather card in its body, and a rain notice
 *     arriving live is shown by the inbox itself (no wait for a page producer); on a non-mobile client the module
 *     registers nothing, so a desktop never shows it
 *   - the page's weatherAlerts.js raises no note of its own for the push (test-weather-rain-card.js has the detail)
 *
 *   node scripts/test-weather-rain-notice.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

const activeSync = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');
const src = require('../modules/notificationInboxSources');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp', f), 'utf8');
const INBOX = read('wmNotificationInbox.js');
const ALERTS = read('weatherAlerts.js');

activeSync.sendInboxNotice = () => 1;
activeSync.sendInboxCleared = () => 1;
let now = Date.parse('2026-11-26T12:00:00Z');
inbox._test.setNow(() => now);
inbox.bind({ getWebSocketServer: () => ({ broadcast() {} }) });

const current = { tempC: 18.4, text: 'Light Rain', isDay: true, icon: 'rain' };
const series = [0, 0.4, 1.2, 4.5, 0.2].map((mmh, i) => ({ t: `2026-11-26T12:${String(i * 4).padStart(2, '0')}`, mmh, rain: i ? 80 : null }));
const push = (extra = {}) => Object.assign({ place: { id: 'home', label: 'Home' }, kind: 'Rain', startsInMin: 0, endsInMin: 20, current, series, seriesStep: 4 }, extra);
const rainRows = () => inbox.list('admin', { includeCleared: true }).filter((n) => n.id.startsWith('rain:'));

// ---- the server: one notice for the spell
src.onRainAlarm(push());
assert.strictEqual(rainRows().length, 1, 'one notice for the spell');
let n = rainRows()[0];
assert.strictEqual(n.id, 'rain:home');
assert.strictEqual(n.cls, 'rain-alarm');
assert.strictEqual(n.title, 'Rain at Home now', 'rain that has started reads now (#1267)');
assert.ok(!/in 0 min/.test(n.title + n.text));
assert.strictEqual(n.data.detail.current.text, 'Light Rain');
assert.strictEqual(n.data.detail.series.length, 5);
assert.strictEqual(n.data.detail.seriesStep, 4);
assert.ok(JSON.stringify(n.data).length < 1500, 'the notice stays small');
// the same spell published again (a re-push, a monitor restart mid-spell): the same row, not a second display
src.onRainAlarm(push());
assert.strictEqual(rainRows().length, 1, 'a second publish of the same spell is not a second row');
// another place is its own notice
src.onRainAlarm(push({ place: { id: 'work', label: 'Work' }, startsInMin: 12 }));
assert.deepStrictEqual(rainRows().map((r) => r.id).sort(), ['rain:home', 'rain:work']);
assert.strictEqual(inbox.get('admin', 'rain:work').title, 'Rain at Work in 12 min');
// no end known and a graph on the notice: the words come from the alarm's minutes, never the provider's summary (#1267)
src.onRainAlarm({ place: { id: 'summ', label: 'Summ' }, kind: 'Light rain', startsInMin: 12, endsInMin: null, summary: 'No precipitation for the next hour', current, series: series.slice(0, 4), seriesStep: 15 });
assert.strictEqual(inbox.get('admin', 'rain:summ').text, 'Light rain from about 12 minutes from now, lasting the rest of the hour.');
src.onRainAlarm({ place: { id: 'one', label: 'One' }, kind: 'Rain', startsInMin: 1, current, series, seriesStep: 4 });
assert.strictEqual(inbox.get('admin', 'rain:one').text, 'Rain from about 1 minute from now, lasting the rest of the hour.');
// an alarm without the next hour still has the notice (text alone)
src.onRainAlarm({ place: { id: 'here', label: 'Here' }, startsInMin: 5, kind: 'Rain' });
assert.deepStrictEqual(inbox.get('admin', 'rain:here').data.detail, { current: null, series: [], seriesStep: 1 });

// ---- the page
function page({ mobile }) {
    const handlers = new Map();
    const notes = [];
    const claims = [];
    const document = { hidden: false, documentElement: { classList: { contains: () => mobile } }, querySelectorAll: () => [], addEventListener: () => {}, dispatchEvent() {}, getElementById: () => null };
    const wsClient = {
        isConnected: () => true,
        on: (t, fn) => { handlers.set(t, fn); },
        sendMessage: (type) => Promise.resolve(type === 'inbox_list' ? { data: { notices: [], total: 0 } } : {}),
    };
    const wmShell = { appNote: (opts) => { notes.push(opts); return { id: `toast-${notes.length}`, update() {}, close() {}, hide() {} }; } };
    const window = { uiShell: mobile ? 'mobile' : 'desktop', wsClient, wmShell, AndroidInbox: { shown: (id) => claims.push(id) }, addEventListener: () => {}, navigator: { language: 'en-GB' }, localStorage: { getItem: () => null } };
    window.window = window;
    const ctx = { window, document, localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) }, setTimeout: () => 0, clearTimeout: () => {}, CustomEvent: class {}, Intl, Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, console };
    vm.createContext(ctx);
    vm.runInContext(ALERTS, ctx, { filename: 'weatherAlerts.js' });
    vm.runInContext(INBOX, ctx, { filename: 'wmNotificationInbox.js' });
    return { window, handlers, notes, claims };
}

// a phone: the inbox shows the notice once, with the card in the body
{
    const p = page({ mobile: true });
    const notice = inbox.get('admin', 'rain:home');
    assert.ok(p.handlers.has('inbox_updated'), 'the phone page listens to the inbox');
    p.window.wmNotificationInbox.showOne(notice);
    assert.strictEqual(p.notes.length, 1, 'one note');
    const body = p.notes[0].html;
    assert.ok(body.startsWith('Rain now, stopping after about 20 minutes.<div class="wx-rain-card">'), body);
    assert.strictEqual((body.match(/class="wx-rain-card"/g) || []).length, 1, 'the card once');
    assert.ok(body.includes('<svg') && body.includes('18°C') && body.includes('Light Rain'));
    assert.strictEqual(p.notes[0].event, 'rain-alarm');
    assert.strictEqual(p.notes[0].title, 'Rain at Home now');

    // live: the server pushes it new; the inbox is the producer and shows it at once (no wait for a page note)
    const live = page({ mobile: true });
    live.handlers.get('inbox_updated')({ data: { reason: 'new', notice: Object.assign({}, inbox.get('admin', 'rain:work'), { state: 'new' }) } });
    assert.strictEqual(live.notes.length, 1, 'shown at once by the inbox');
    assert.ok(live.notes[0].html.includes('wx-rain-card'));
    // the same notice pushed again while its note is up: not a second note
    live.handlers.get('inbox_updated')({ data: { reason: 'new', notice: Object.assign({}, inbox.get('admin', 'rain:work'), { state: 'new' }) } });
    assert.strictEqual(live.notes.length, 1, 'no second note');

    // no detail (an app-posted notification): text alone
    const bare = page({ mobile: true });
    bare.window.wmNotificationInbox.showOne(inbox.get('admin', 'rain:here'));
    assert.ok(!bare.notes[0].html.includes('wx-rain-card'), 'text alone without detail');

    // the page's own push shows no note of its own on the phone
    p.window.wsClient.on('x', () => {});
    p.handlers.get('weather_rain_alarm')({ data: push() });
    assert.strictEqual(p.notes.length, 1, 'the weather_rain_alarm push adds no note');
}

// a desktop client: the module registers nothing, so a rain notice can never appear there
{
    const d = page({ mobile: false });
    assert.strictEqual(d.window.wmNotificationInbox, undefined, 'no inbox module on a desktop');
    assert.ok(!d.handlers.has('inbox_updated'), 'it listens to nothing');
    d.handlers.get('weather_rain_alarm')({ data: push() });
    assert.strictEqual(d.notes.length, 0, 'the desktop shows nothing for the alarm');
}

console.log('weather rain notice: ok');
process.exit(0);
