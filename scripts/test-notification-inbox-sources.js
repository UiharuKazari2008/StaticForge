#!/usr/bin/env node
'use strict';
// Server-raised phone notifications (Yozora #876): node scripts/test-notification-inbox-sources.js
// Each source (mail, texts, Messenger, Director, prints, weather) publishes into the inbox with the id the
// page uses, the page's wording, and goes to the phones (inbox.notice); read / dismissed clears it and the
// phones hear inbox.cleared. Quiet classes (Display message off) are stored seen and never posted.
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

const activeSync = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');
const src = require('../modules/notificationInboxSources');

// spies on the phones' background links
const toPhones = [];
const clearedOnPhones = [];
const realNotice = activeSync.sendInboxNotice;
const realCleared = activeSync.sendInboxCleared;
activeSync.sendInboxNotice = (gr, ws, notice) => { toPhones.push(notice); return 1; };
activeSync.sendInboxCleared = (gr, ws, n) => { clearedOnPhones.push(n); return 1; };

const pushed = [];
const gr = { getWebSocketServer: () => ({ broadcast: (m) => pushed.push(m) }) };
let now = Date.parse('2026-11-16T12:00:00Z');
inbox._test.setNow(() => now);
inbox.bind(gr);

const byId = (id, user = 'admin') => inbox.list(user, { includeCleared: true }).find((n) => n.id === id);

(async () => {
    // ---- mail: new (notify on) -> an item of the one mail stack (#1098: stack:mail, items keep mail:<account>:<folder>:<uid>);
    // \Seen / removed takes the item out of the stack, the last one clears it (the stack itself is tested in test-notification-inbox-stack.js)
    src.onMailEvent({ event: 'new', accountId: 'gmail', folder: 'INBOX', uids: [41], notify: true, message: { uid: 41, folder: 'INBOX', subject: 'Dinner', from: [{ name: 'Mika', address: 'mika@example.com' }] } });
    let n = byId('stack:mail');
    assert.ok(n, 'mail stack stored');
    assert.ok(!byId('mail:gmail:INBOX:41'), 'a mail is an item of the stack, not a row of its own');
    assert.strictEqual(n.title, 'New E-mail Message', 'one item: its own title');
    assert.strictEqual(n.text, 'From: Mika\nDinner', 'one item: its own text');
    assert.strictEqual(n.cls, 'mail');
    assert.strictEqual(n.data.items[0].id, 'mail:gmail:INBOX:41', 'the item keeps the mail id');
    assert.deepStrictEqual([n.data.items[0].data.app, n.data.items[0].data.kind, n.data.items[0].data.accountId, n.data.items[0].data.uid], ['messaging', 'mail', 'gmail', 41]);
    assert.strictEqual(toPhones.pop().id, 'stack:mail', 'sent to the phones');
    src.onMailEvent({ event: 'new', accountId: 'gmail', folder: 'INBOX', uids: [42], notify: false, message: { uid: 42, subject: 'x' } });
    assert.strictEqual(byId('stack:mail').data.count, 1, 'notify off: nothing');
    src.onMailEvent({ event: 'new', accountId: 'gmail', folder: 'INBOX', uids: [43], notify: true, message: { uid: 43, subject: '', sender: '"Ann Lee" <ann@example.com>' } });
    n = byId('stack:mail');
    assert.strictEqual(n.data.count, 2);
    assert.strictEqual(n.data.items[0].text, 'From: Ann Lee\n(no subject)', 'sender header name, (no subject)');
    toPhones.length = 0;
    src.onMailEvent({ event: 'flags', accountId: 'gmail', folder: 'INBOX', uids: [41], flags: { 41: ['\\Seen'] } });
    n = byId('stack:mail');
    assert.deepStrictEqual(n.data.items.map((x) => x.id), ['mail:gmail:INBOX:43'], 'read takes the item out of the stack');
    assert.strictEqual(n.state, 'new', 'the stack stays while an item waits');
    assert.strictEqual(clearedOnPhones.length, 0, 'phones are not told the stack is cleared');
    assert.deepStrictEqual(toPhones.map((x) => [x.id, x.alert]), [['stack:mail', false]], 'but get the silent update');
    src.onMailEvent({ event: 'removed', accountId: 'gmail', folder: 'INBOX', uids: [43] });
    assert.strictEqual(byId('stack:mail').state, 'cleared', 'removed clears (the last item clears the stack)');
    assert.deepStrictEqual(clearedOnPhones.pop(), { user: 'admin', id: 'stack:mail' }, 'phones told cleared');
    clearedOnPhones.length = 0;

    // ---- text messages: per conversation, the newest line supersedes; read / my reply clears
    const tm = (text, extra) => Object.assign({ event: 'message', accountId: 'rcs1', chatGuid: 'c9', notify: true, chatTitle: 'Mika', isGroup: false, message: { text, sender: { name: 'Mika', address: '+1555' } } }, extra || {});
    src.onTextEvent(tm('hello'));
    src.onTextEvent(tm('are you there?'));
    n = byId('sms:rcs1:c9');
    assert.strictEqual(n.title, 'New Text Message');
    assert.strictEqual(n.text, 'From: Mika\nare you there?', 'newest line replaces');
    assert.strictEqual(inbox.list('admin').filter((x) => x.id.startsWith('sms:')).length, 1, 'one per conversation');
    src.onTextEvent(tm('', { message: { text: '', attachments: [{ mime: 'image/jpeg' }], sender: { name: 'Mika' } } }));
    assert.strictEqual(byId('sms:rcs1:c9').text, 'From: Mika\nPicture', 'attachment wording');
    src.onTextEvent({ event: 'read', accountId: 'rcs1', chatGuid: 'c9', read: true });
    assert.strictEqual(byId('sms:rcs1:c9').state, 'cleared');
    assert.strictEqual(clearedOnPhones.pop().id, 'sms:rcs1:c9');
    src.onTextEvent(tm('again'));
    assert.strictEqual(byId('sms:rcs1:c9').state, 'new', 'a new text makes it new again');
    src.onTextEvent(tm('ok', { notify: false, message: { text: 'ok', fromMe: true } }));
    assert.strictEqual(byId('sms:rcs1:c9').state, 'cleared', 'my reply clears it');
    src.onTextEvent(tm('group line', { chatGuid: 'g1', isGroup: true, chatTitle: 'Family' }));
    assert.strictEqual(byId('sms:rcs1:g1').text, 'From: Mika\ngroup line', 'group: the sender');
    src.onTextEvent({ event: 'message', accountId: 'rcs1', chatGuid: 'u1', notify: false, message: { text: 'spam' } });
    assert.ok(!byId('sms:rcs1:u1'), 'unknown sender with notify off: nothing');
    src.onTextEvent({ event: 'signin_lost', accountId: 'rcs1', text: 'Google signed Dreamscape out of Google Messages.' });
    assert.strictEqual(byId('tm-signin:rcs1').title, 'Text messages stopped');

    // ---- Dreamscape Messenger: only a reply to the phone (or a socket that has gone)
    const raw = JSON.stringify([{ type: 'actions', content: 'smiles' }, { type: 'speech', content: 'Good morning!' }]);
    assert.strictEqual(src.onChatReply({ chatId: 7, session: { character_name: 'Chiyo' }, raw, clientInfo: { userType: 'admin', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, ws: { readyState: 1 } }), null, 'desktop chat: no phone notice');
    src.onChatReply({ chatId: 7, session: { character_name: 'Chiyo' }, raw, clientInfo: { userType: 'admin', as: { kind: 'device' } }, ws: { readyState: 1 } });
    n = byId('chat:7');
    assert.strictEqual(n.title, 'Dreamscape Messenger');
    assert.strictEqual(n.text, 'From: Chiyo\nGood morning!');
    assert.strictEqual(n.cls, 'chat');
    assert.deepStrictEqual([n.data.app, n.data.kind, n.data.chatId, n.data.said], ['chat', 'chat', '7', 'Good morning!']);
    src.onChatReply({ chatId: 8, session: { chat_name: 'Yumiya' }, raw: '```json\n[{"type":"myname","content":"Yumi"}]\n```', clientInfo: { userType: 'admin', userAgent: 'Mozilla/5.0 (Windows)' }, ws: { readyState: 3 } });
    assert.strictEqual(byId('chat:8').text, 'From: Yumiya\nMy name is Yumi', 'closed socket notifies; myname wording');
    src.onChatReply({ chatId: 9, raw, clientInfo: { userType: 'dev_admin', userAgent: 'Android' }, ws: { readyState: 1 } });
    assert.ok(byId('chat:9', 'dev_admin') && !byId('chat:9'), 'dev_admin keeps its own queue');
    assert.strictEqual(src._test.saidOf(null, 'plain words'), 'plain words', 'non-JSON reply is the line');

    // ---- Director: running -> idle; shown by default since Nov 16; a class the phone made quiet is stored seen, never posted
    toPhones.length = 0;
    inbox.setQuiet('admin', ['director']);
    src.onDirectorStatus({ running: false });
    src.onDirectorStatus({ running: true, sessionId: 's1', sessionName: 'Morning prints' });
    assert.ok(!byId('director:s1:turn'), 'nothing while running');
    src.onDirectorStatus({ running: false, sessionId: null, sessionName: null });
    n = byId('director:s1:turn');
    assert.strictEqual(n.title, 'Director');
    assert.strictEqual(n.text, 'Yumiya replied in "Morning prints".', 'the notice is the reply, not the turn end');
    assert.strictEqual(n.state, 'seen', 'quiet when the phone says so (Display message off)');
    assert.strictEqual(toPhones.length, 0, 'a quiet class is not posted on the phones');
    // the phone switched Display message on: posted
    inbox.setQuiet('admin', []);
    src.onDirectorStatus({ running: false, xi: { running: true, sessionId: 'x2', sessionName: '' } });
    src.onDirectorStatus({ running: false, xi: { running: false } });
    n = byId('director:x2:turn');
    assert.strictEqual(n.text, 'Yozora replied.', 'Xi, no name');
    assert.strictEqual(n.state, 'new');
    assert.strictEqual(toPhones.pop().id, 'director:x2:turn');
    src.onDirectorStatus({ running: true, xi: null, sessionId: 'x2' });
    assert.strictEqual(byId('director:x2:turn').state, 'cleared', 'a new turn clears the last finished notice');
    // the persona that answered names the reply: a Chiyo session (its own memory store) is not read as Yumiya
    src.onDirectorStatus({ running: true, sessionId: 's3', sessionName: 'Night shift', sessions: [{ id: 's3', name: 'Night shift', memoryStore: 'obliterated' }] });
    src.onDirectorStatus({ running: false, sessionId: null, sessionName: null, sessions: [{ id: 's3', name: 'Night shift', memoryStore: 'obliterated' }] });
    assert.strictEqual(byId('director:s3:turn').text, 'Chiyo replied in "Night shift".');

    // ---- prints: the FIFO's phone jobs only; failures only (#1040); once per job
    const listeners = [];
    inbox.publish({ user: 'admin', app: 'studio', id: 'print:old', cls: 'print', title: 'DreamStudio', text: 'Your print is ready.' });
    src.bindPrintQueue({ onChange: (fn) => listeners.push(fn) });
    assert.strictEqual(byId('print:old').state, 'cleared', 'a ready notice from before #1040 is cleared on bind');
    const fire = (job) => listeners.forEach((fn) => fn(job));
    fire({ id: 'j1', owner: 'Studio', status: 'completed', result: { success: true, filename: 'a.png' } });
    assert.ok(!byId('print:j1'), 'a desktop print: no phone notice');
    fire({ id: 'j2', owner: 'Melaton Mobile', status: 'running' });
    assert.ok(!byId('print:j2'), 'running: nothing');
    fire({ id: 'j2', owner: 'Melaton Mobile', userType: 'admin', status: 'completed', result: { success: true, flat: { filenames: ['a.png', 'b.png'] } } });
    assert.ok(!byId('print:j2'), 'a finished print: no notice (#1040)');
    fire({ id: 'j3', owner: 'Melaton Mobile', status: 'completed', result: { success: true, filename: 'c.png' } });
    assert.ok(!byId('print:j3'), 'a finished print: no notice (#1040)');
    fire({ id: 'j4', owner: 'Melaton Mobile', status: 'failed', error: new Error('NovelAI is busy') });
    n = byId('print:j4');
    assert.deepStrictEqual([n.text, n.cls], ['NovelAI is busy', 'print-error']);
    fire({ id: 'j5', owner: 'Melaton Mobile', userType: 'user', status: 'completed', result: { success: true } });
    assert.ok(!byId('print:j5'), 'no inbox for other user types');

    // ---- weather: an alert until it ends, the rain alarm for its spell
    src.onWeatherAlert({ alert: { id: 'a1', title: 'Wind Advisory', severity: 'moderate', expires: '2026-11-16T21:00' }, place: { id: 'home', label: 'Home', name: 'Jersey City' } });
    n = byId('wx:a1');
    assert.strictEqual(n.title, 'Wind Advisory');
    assert.match(n.text, /^Home \(Jersey City\)\. (Until|Ended) .*9:00 PM$/, 'what place and when, #1200');
    assert.strictEqual(n.cls, 'weather-alert');
    const rainCurrent = { tempC: 18.4, text: 'Light Rain', isDay: true, icon: 'rain' };
    const rainSeries = [{ t: '2026-11-16T12:00', mmh: 0, rain: null }, { t: '2026-11-16T12:04', mmh: 1.2, rain: 80 }];
    src.onRainAlarm({ place: { id: 'work', label: 'Work' }, startsInMin: 20, endsInMin: 50, kind: 'Rain', current: rainCurrent, series: rainSeries, seriesStep: 4 });
    n = byId('rain:work');
    assert.strictEqual(n.title, 'Rain at Work in 20 min');
    assert.strictEqual(n.text, 'Rain from about 20 minutes from now, stopping after about 30 minutes.');
    assert.strictEqual(n.cls, 'rain-alarm');
    // the card's data rides with the notice (#1337): the current weather and the next hour, small (no timestamps)
    assert.deepStrictEqual(n.data, { app: 'weather', kind: 'rain', placeId: 'work', detail: { current: rainCurrent, series: [{ mmh: 0, rain: null }, { mmh: 1.2, rain: 80 }], seriesStep: 4 } });
    // dismissed, it is still the spell's alarm: inbox.get keeps it (any state) until it expires, so the weather monitor
    // that restarted mid-spell does not raise it again (weatherService rainAlarmLive, #1061)
    src.onRainAlarm({ place: { id: 'home', label: 'Home' }, startsInMin: 10, endsInMin: 40, kind: 'Rain' });
    inbox.clear('admin', 'rain:home');
    const kept = inbox.get('admin', 'rain:home');
    assert.strictEqual(kept.state, 'cleared');
    assert.ok(kept.expiresAt > now, 'still the spell');
    assert.strictEqual(inbox.get('admin', 'rain:nowhere'), null);

    // ---- expiry: an expired notice leaves the phones too
    clearedOnPhones.length = 0;
    now += 90 * 60 * 1000; // the rain alarm's life (50 + 15 min) is over
    inbox.prune('admin');
    assert.ok(!byId('rain:work'), 'expired rain alarm pruned');
    assert.ok(clearedOnPhones.some((x) => x.id === 'rain:work'), 'phones told the expired one is cleared');

    // ---- page acks: dismissed / acted -> phones cleared once; seen does not clear
    clearedOnPhones.length = 0;
    inbox.ack('admin', 'print:j4', 'seen');
    assert.strictEqual(clearedOnPhones.length, 0, 'seen leaves the Android copy');
    inbox.ack('admin', 'print:j4', 'acted');
    inbox.ack('admin', 'print:j4', 'cleared');
    assert.deepStrictEqual(clearedOnPhones.map((x) => x.id), ['print:j4'], 'acted then cleared: one inbox.cleared');
    assert.strictEqual(inbox.clearWhere('admin', 'mail:gmail:'), 0, 'nothing left to clear for the account');

    // ---- activeSync.sendInboxCleared: every partnered phone's service link, { id } only
    activeSync.sendInboxNotice = realNotice;
    activeSync.sendInboxCleared = realCleared;
    const sentTo = [];
    const mk = (id, speaker, session) => [{ readyState: 1, id: `${id}-${speaker}` }, { as: { kind: 'device', id, speaker, session, since: 1 } }];
    const fakeServer = {
        clients: new Map([mk('fold7', 'service', 'partner'), mk('fold7', 'webview', 'partner'), mk('a53', 'service', 'guest'), mk('tab', 'service', 'partner')]),
        sendToClient: (ws, msg) => sentTo.push({ ws: ws.id, msg }),
    };
    assert.strictEqual(activeSync.sendInboxCleared(null, fakeServer, { user: 'admin', id: 'chat:7' }), 2, 'two partnered phones with a service link');
    assert.deepStrictEqual(sentTo.map((x) => x.ws).sort(), ['fold7-service', 'tab-service']);
    assert.strictEqual(sentTo[0].msg.type, 'as_event');
    assert.strictEqual(sentTo[0].msg.data.event, 'inbox.cleared');
    assert.deepStrictEqual(sentTo[0].msg.data.detail, { id: 'chat:7' });
    sentTo.length = 0;
    activeSync.sendInboxNotice(null, fakeServer, { id: 'x', title: 't' });
    const fold = sentTo.find((x) => x.ws === 'fold7-service');
    assert.strictEqual(fold.msg.data.event, 'inbox.notice');
    assert.strictEqual(fold.msg.data.detail.pageConnected, true, 'fold7 page is connected');
    assert.strictEqual(sentTo.find((x) => x.ws === 'tab-service').msg.data.detail.pageConnected, false);

    inbox._test.reset();
    console.log('notification inbox sources: all checks passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
