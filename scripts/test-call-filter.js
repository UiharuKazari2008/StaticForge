'use strict';
// a scratch inbox: a test must never touch the live one (its rows land on Yukimi's phone as notices, #1196)
process.env.NOTIFICATION_INBOX_DB = require('path').join(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'inbox-call-filter-')), 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
// node scripts/test-call-filter.js  (#1107)
const assert = require('assert');
const cf = require('../modules/callFilter');
const tm = require('../modules/textMessaging');
const inbox = require('../modules/notificationInbox');
const prefs = {};
inbox.getPref = (u, k) => prefs[k] || '';
inbox.setPref = (u, k, v) => { prefs[k] = v; };
const published = [];
inbox.publish = (n) => { published.push(n); return n; };
let ready = true; const contacts = new Set(['5551234567']);
tm.isContactNumberSync = (n) => contacts.has(String(n).replace(/\D/g, '').slice(-10));
tm.contactsReady = () => ready;
cf._reset();
const call = (title, text = 'Incoming call', extra = {}) => Object.assign({ package: 'com.samsung.android.incallui', category: 'call', title, text }, extra);

assert.strictEqual(cf.vet({ package: 'x.y', category: 'msg', title: '+1 555 000 0000' }).pass, true, 'not a call');
assert.strictEqual(cf.vet(call('Mom')).pass, true, 'saved contact (name)');
assert.strictEqual(cf.vet(call('+1 (555) 123-4567')).pass, true, 'number on a card');
const u = cf.vet(call('+1 800 555 0199'));
assert.deepStrictEqual([u.pass, u.kind], [false, 'unknown'], 'unknown number is only noted');
assert.strictEqual(cf.vet(call('+1 800 555 0188', 'Suspected spam call')).kind, 'spam');
assert.strictEqual(cf.vet(call('800-555-0123', 'Outgoing call')).pass, true, 'dialing passes and is remembered');
assert.strictEqual(cf.vet(call('800-555-0123')).pass, true, 'a number dialed before is known');
ready = false; assert.strictEqual(cf.vet(call('+1 900 555 0100')).pass, true, 'contacts not ready: never hush'); ready = true;
cf.setSettings({ on: false }); assert.strictEqual(cf.vet(call('+1 800 555 0177')).pass, true, 'off'); cf.setSettings({ on: true });

// summary: one quiet notice, not per item, then nothing more
const s1 = cf.summarize();
assert.ok(s1 && s1.id === 'callsummary' && s1.alert === false && /1 call from unknown numbers/.test(s1.text) && /1 spam call/.test(s1.text), JSON.stringify(s1));
assert.strictEqual(cf.summarize(), null, 'nothing new, no summary');
cf.noteSkipped({ id: 'sms:a:b', cls: 'sms', title: 'x' }); cf.noteSkipped({ id: 'sms:a:b', cls: 'sms', title: 'x' });
assert.match(cf.summarize().text, /^1 missed notification$/, 'dedupes by id');
cf.setSettings({ summary: false }); cf.vet(call('+1 800 555 0166')); assert.strictEqual(cf.summarize(), null, 'summary can be switched off');
cf.setSettings({ summary: true });
// hello after a long absence
let t = 1e12; cf._now(() => t); cf._reset();
cf.vet(call('+1 800 555 0155')); cf.onHello('d'); t += 5 * 60000; assert.strictEqual(cf.onHello('d'), null, 'short gap: no summary');
t += 40 * 60000; const s2 = cf.onHello('d'); assert.ok(s2 && /unknown/.test(s2.text), 'long gap: one summary');
console.log('call filter: ok');
