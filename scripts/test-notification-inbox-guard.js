#!/usr/bin/env node
'use strict';
// The inbox guard (Yukimi, Nov 27 2026, #1299): a notice with no body or no call to action registers nothing and is filed
// to the server fault store. node scripts/test-notification-inbox-guard.js
//   - each refusal: no body (empty, blank, missing), no call to action, both; publish returns null
//   - a refused notice stores nothing, broadcasts nothing, reaches no phone
//   - one fault report per source + gap per hour (the throttle is an in-memory Map)
//   - the report reaches the real fault store (serverFaultCapture, kind 'swallowed') with the app, id, class, title, gap
//   - what passes: actions, an answerable notice, a body with an app (a tap target), stacked items with both
//   - the test lane (user 'test') is exempt
//   - every real sender's notice (the shapes of notificationInboxSources, fleetNotices, deviceConsentNotices, and the
//     other modules' publish calls, built the way they build them) passes
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-guard-'));
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
process.env.AGENT_SUPERVISOR_NO_REVIVE = '1';

const activeSync = require('../modules/activeSync');
const phoneStatus = require('../modules/phoneStatus');
const inbox = require('../modules/notificationInbox');
const faults = require('../modules/serverFaultCapture');
const src = require('../modules/notificationInboxSources');

// spies: the phones' links, the pages' broadcast, the fault store
const toPhones = [];
activeSync.sendInboxNotice = (g, ws, notice) => { toPhones.push(notice); return 1; };
activeSync.sendInboxCleared = () => 1;
phoneStatus.touch = () => {};
const pushed = [];
const cfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter' } };
const gr = { getConfig: () => cfg, modifyConfig: () => ({ assign: async (p, v) => { cfg[p[0]] = v; } }), getWebSocketServer: () => ({ broadcast: (m) => pushed.push(m) }), getApiKeyManager: () => ({ getActiveApiKey: () => '' }) };
let now = Date.parse('2026-11-27T12:00:00Z');
inbox._test.setNow(() => now);
inbox.bind(gr);

const filed = []; // [error, kind, extra] per serverFaultCapture.capture call
const realCapture = faults.capture;
faults.capture = (err, kind, extra) => { filed.push([err, kind, extra]); return true; };

const reset = () => { inbox._test.reset(); inbox._test.setNow(() => now); inbox.bind(gr); inbox._test.guardReset(); toPhones.length = 0; pushed.length = 0; filed.length = 0; };
const stored = (user = 'admin') => inbox.list(user, { includeCleared: true });
const nothing = (what) => {
    assert.strictEqual(stored().length, 0, `${what}: no row`);
    assert.strictEqual(stored('test').length, 0, `${what}: no test-lane row`);
    assert.strictEqual(pushed.filter((m) => m && m.type === 'inbox_updated').length, 0, `${what}: no broadcast`);
    assert.strictEqual(toPhones.length, 0, `${what}: no phone push`);
    assert.strictEqual(inbox.count('admin'), 0, `${what}: the title bar counts nothing`);
};

let failed = 0;
let passed = 0;
const tests = [];
const test = (name, f) => { tests.push([name, f]); };

const ok = (n) => Object.assign({ id: 'g:1', title: 'Title', text: 'Body', actions: ['view'] }, n);

// ---- the refusals ----
test('no body: empty, blank, whitespace-only, missing, non-string empty - each refused with its gap named', () => {
    for (const text of ['', '   ', '\n\t \n', undefined, null]) {
        reset();
        const n = { id: 'fleet-work:1:done', app: 'claudedesk', title: 'Fix is done', actions: [{ id: 'open', label: 'Open' }], data: { app: 'claudedesk' } };
        if (text !== undefined) n.text = text;
        assert.strictEqual(inbox.publish(n), null, `text ${JSON.stringify(text)} refused`);
        nothing(`text ${JSON.stringify(text)}`);
        assert.strictEqual(filed.length, 1);
        assert.strictEqual(filed[0][2].missing, 'body');
    }
});

test('no call to action: a body alone (no actions, no data, no app) is refused', () => {
    assert.strictEqual(inbox.publish({ id: 'x:1', title: 'Sync finished', text: 'All good.' }), null);
    nothing('body alone');
    assert.strictEqual(filed[0][2].missing, 'action');
});

test('no call to action: empty actions, data without app, buttons without an answer type, an answer type without buttons', () => {
    const bare = [
        { actions: [] },
        { actions: ['', '  '] },
        { actions: [null] },
        { data: {} },
        { data: { app: '' } },
        { app: '   ' },
        { data: { buttons: [{ id: 'a', label: 'A' }] } },
        { data: { answerType: 'device_consent_answer' } },
        { data: { buttons: [], answerType: 'device_consent_answer' } },
        { data: { app: 42 } },
    ];
    bare.forEach((extra, i) => {
        reset();
        assert.strictEqual(inbox.publish(Object.assign({ id: `bare:${i}`, title: 'T', text: 'Body' }, extra)), null, `bare ${i}: ${JSON.stringify(extra)}`);
        nothing(`bare ${i}`);
        assert.strictEqual(filed[0][2].missing, 'action');
    });
});

test('neither a body nor a call to action: body+action', () => {
    assert.strictEqual(inbox.publish({ id: 'x:2', title: 'Hello', text: '' }), null);
    nothing('neither');
    assert.strictEqual(filed.length, 1);
    assert.strictEqual(filed[0][2].missing, 'body+action');
});

test('a bad notice (no id / title) is still null as before and is not a guard report', () => {
    assert.strictEqual(inbox.publish({ title: 'x', text: 'y', actions: ['view'] }), null);
    assert.strictEqual(inbox.publish({ id: 'x', text: 'y', actions: ['view'] }), null);
    assert.strictEqual(filed.length, 0);
    nothing('bad notice');
});

test('an expired notice is null and not a guard report', () => {
    assert.strictEqual(inbox.publish({ id: 'old:1', title: 'T', text: '', expiresAt: now - 1000 }), null);
    assert.strictEqual(filed.length, 0);
});

// ---- the stacked path ----
test('stacked: an item with no text is refused (the stack body comes from its items), nothing stored; with no key either', () => {
    assert.strictEqual(inbox.publish({ id: 'fleet-work:3:done', app: 'claudedesk', cls: 'notification', stack: 'fleetdone', title: 'Item is done', text: '', actions: [{ id: 'open', label: 'Open' }], data: { app: 'claudedesk', workId: 3 } }), null);
    nothing('stacked, no body');
    assert.strictEqual(filed[0][2].missing, 'body');
    assert.strictEqual(inbox.publish({ id: 'm:1', cls: 'mail', stack: 'mail', title: 'New E-mail Message', text: 'From: a\nhi' }), null);
    nothing('stacked, no action');
    assert.strictEqual(filed[1][2].missing, 'action');
});

test('stacked: an item with a body and a key joins; a later item with no body is refused and the stack stays as it was', () => {
    const item = (k, over) => Object.assign({ id: `fleet-work:${k}:done`, app: 'claudedesk', cls: 'notification', stack: 'fleetdone', title: `Item ${k} is done`, text: `Landed ${k}`, actions: [{ id: 'open', label: 'Open' }], data: { app: 'claudedesk', kind: 'work-done', workId: k }, ttlMs: 3600000 }, over);
    assert.ok(inbox.publish(item(1)));
    assert.ok(inbox.publish(item(2)));
    assert.strictEqual(inbox.publish(item(3, { text: '  ' })), null);
    const row = stored().find((n) => n.id === 'stack:fleetdone');
    assert.strictEqual(row.data.count, 2, 'the refused item never joined');
    assert.deepStrictEqual(row.data.items.map((x) => x.id), ['fleet-work:2:done', 'fleet-work:1:done']);
    assert.ok(row.text.trim() && row.actions.length, 'the stack row has a body and the Open key');
});

// ---- the report ----
test('one report per source + gap per hour; another source, another gap, or the hour over files again', () => {
    // an app is a tap target, so a notice with an app can only lack a body; with no app it can lack both (source: the id's prefix)
    const noBody = (app, id) => inbox.publish({ id, app, title: 'T', text: '' });
    for (let i = 0; i < 10; i += 1) noBody('lapis', `lapis:${i}`);
    assert.strictEqual(filed.length, 1, 'a flood from one source and gap is one report');
    for (let i = 0; i < 5; i += 1) noBody('', `lapis:t${i}`);
    assert.strictEqual(filed.length, 2, 'no app: the id prefix is the source - here the same name with another gap (body+action) is its own report');
    assert.strictEqual(filed[1][2].source, 'notificationInbox.guard:lapis');
    assert.strictEqual(filed[1][2].missing, 'body+action');
    noBody('weather', 'wx:1');
    assert.strictEqual(filed.length, 3, 'another source is its own report');
    noBody('', 'sms:acc:1');
    noBody('', 'sms:acc:2');
    assert.strictEqual(filed.length, 4, 'no app: the id prefix is the source, once');
    assert.strictEqual(filed[3][2].source, 'notificationInbox.guard:sms');
    now += 59 * 60 * 1000;
    noBody('lapis', 'lapis:later');
    assert.strictEqual(filed.length, 4, 'inside the hour: still counted, not filed');
    now += 2 * 60 * 1000;
    noBody('lapis', 'lapis:later2');
    assert.strictEqual(filed.length, 5, 'the hour is over: filed again');
    nothing('the flood');
});

test('the report: an Error naming the problem, kind swallowed, extra with app / id / cls / title (clipped) / missing / source', () => {
    inbox.publish({ id: 'fleet-work:9:done', app: 'claudedesk', cls: 'notification', title: `${'Long title '.repeat(20)}is done`, text: '', data: { app: 'claudedesk' } });
    assert.strictEqual(filed.length, 1);
    const [err, kind, extra] = filed[0];
    assert.ok(err instanceof Error);
    assert.match(err.message, /Notice refused by the inbox guard: no body \(source claudedesk, class notification\)/);
    assert.match(err.message, /not registered/);
    assert.strictEqual(kind, 'swallowed');
    assert.strictEqual(extra.app, 'claudedesk');
    assert.strictEqual(extra.id, 'fleet-work:9:done');
    assert.strictEqual(extra.cls, 'notification');
    assert.strictEqual(extra.missing, 'body');
    assert.strictEqual(extra.source, 'notificationInbox.guard:claudedesk');
    assert.ok(extra.title.length <= 80 && extra.title.endsWith('...'), 'title clipped');
    assert.match(extra.note, /app=claudedesk id=fleet-work:9:done cls=notification missing=body title=/, 'the note carries it into the stored report');
});

test('the report reaches the real fault store: the first one is written at once, the flood after it is counted not written', () => {
    faults.capture = realCapture;
    const bodies = [];
    faults._reset();
    faults.install({ store: { upsert: (b) => { bodies.push(b); return Promise.resolve(); } } });
    try {
        for (let i = 0; i < 6; i += 1) inbox.publish({ id: `ingest:${i}`, app: 'ingest', cls: 'notification', title: 'Ingest', text: '' });
        assert.strictEqual(bodies.length, 1, 'one fault written for the flood');
        const b = bodies[0];
        assert.strictEqual(b.surface, 'server');
        assert.strictEqual(b.kind, 'swallowed');
        assert.strictEqual(b.errorName, 'NoticeRefused');
        assert.match(b.message, /no body \(source ingest/);
        assert.strictEqual(b.source, 'notificationInbox.guard:ingest');
        assert.strictEqual(b.program.key, 'server:modules/notificationInbox.js');
        assert.match(b.extraFaults[0].message, /app=ingest id=ingest:0 cls=notification missing=body/);
    } finally {
        faults._reset();
        faults.capture = (err, kind, extra) => { filed.push([err, kind, extra]); return true; };
    }
});

test('a fault store that throws never breaks publish', () => {
    faults.capture = () => { throw new Error('store down'); };
    assert.strictEqual(inbox.publish({ id: 'x:3', title: 'T', text: '' }), null);
    faults.capture = (err, kind, extra) => { filed.push([err, kind, extra]); return true; };
});

// ---- what passes ----
test('a body with a non-empty actions array passes (an id string or an object), stored and sent', () => {
    assert.ok(inbox.publish(ok({ id: 'a:1', actions: ['view'] })));
    assert.ok(inbox.publish(ok({ id: 'a:2', actions: [{ id: 'open', label: 'Open' }] })));
    assert.strictEqual(stored().length, 2);
    assert.strictEqual(toPhones.length, 2);
    assert.strictEqual(filed.length, 0);
});

test('an answerable notice passes (data.buttons + data.answerType, no app, no actions)', () => {
    const r = inbox.publish({ id: 'ask:1', title: 'Claude wants the phone', text: 'For up to 20 min.', data: { buttons: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }], answerType: 'device_consent_answer' } });
    assert.ok(r && r.id === 'ask:1');
    assert.strictEqual(filed.length, 0);
});

test('a body with an app passes: data.app, or the notice\'s own app (what openFor opens on a tap)', () => {
    assert.ok(inbox.publish({ id: 'b:1', title: 'Rain', text: 'Rain at 5.', data: { app: 'weather' } }));
    assert.ok(inbox.publish({ id: 'b:2', app: 'plaud', title: 'Plaud', text: 'Sign in.' }));
    assert.ok(inbox.publish({ id: 'b:3', title: 'Fleet', text: 'Needs you.', data: { app: 'claudedesk', workId: 4 } }));
    assert.strictEqual(filed.length, 0);
});

test('an answerable notice still passes the quiet class (the guard changed nothing else): stored seen for a quiet class, new when answerable', () => {
    inbox.setQuiet('admin', ['notification']);
    const quiet = inbox.publish(ok({ id: 'q:1', cls: 'notification' }));
    assert.strictEqual(quiet.state, 'seen');
    const ask = inbox.publish({ id: 'q:2', cls: 'notification', title: 'Ask', text: 'Allow?', data: { buttons: [{ id: 'a', label: 'A' }], answerType: 'x_answer' } });
    assert.strictEqual(ask.state, 'new');
});

test('the test lane is exempt: a bare test notice is stored and nothing is filed', () => {
    const r = inbox.publish({ user: 'test', id: 'test:1', title: 'Test notice', text: '' });
    assert.ok(r, 'stored');
    assert.strictEqual(inbox.list('test').length, 1);
    const r2 = inbox.publish({ user: 'test', id: 'test:2', title: 'Test notice 2', text: 'x', push: false });
    assert.ok(r2);
    assert.strictEqual(filed.length, 0, 'the lane files nothing');
    assert.strictEqual(inbox.publish({ user: 'dev_admin', id: 'dev:1', title: 'Dev', text: '' }), null, 'dev_admin is not exempt');
    assert.strictEqual(filed.length, 1);
});

test('digest, alert and dedup behaviour is unchanged: the same notice again is updated in place, silent', () => {
    const a = inbox.publish(ok({ id: 'd:1', alert: true }));
    assert.strictEqual(a.alert, true);
    const b = inbox.publish(ok({ id: 'd:1', text: 'Body 2' }));
    assert.strictEqual(b.alert, false);
    assert.strictEqual(stored().length, 1);
});

// ---- every real sender passes ----
const cleanly = (what, f) => { const before = filed.length; const r = f(); assert.strictEqual(filed.length, before, `${what}: the guard filed nothing (${filed.slice(before).map((x) => x[0].message).join('; ')})`); return r; };

test('notificationInboxSources: mail, Dovecote mail, questions, eMotion, system, API keys, texts, Messenger, prints, weather, rain, XM Radio, Director', () => {
    cleanly('mail', () => src.onMailEvent({ event: 'new', accountId: 'gmail', folder: 'INBOX', uids: [1], notify: true, message: { uid: 1, folder: 'INBOX', subject: 'Dinner', from: [{ name: 'Mika', address: 'm@x.test' }] } }));
    cleanly('mail without a subject or sender', () => src.onMailEvent({ event: 'new', accountId: 'gmail', folder: 'INBOX', uids: [2], notify: true, message: { uid: 2, folder: 'INBOX' } }));
    cleanly('dmail', () => src.onDovecoteNewMail({ id: 5, mailbox: 'yukimi', from: '"Ann" <a@x.test>', subject: '' }));
    cleanly('question', () => src.onQuestion({ id: 'f1', title: '', fields: [] }));
    cleanly('question with fields', () => src.onQuestion({ id: 'f2', title: 'Pick', fields: [{ label: 'Size' }] }));
    cleanly('emotion done', () => src.onEmotionDone({ status: 'completed', requestId: 'r1' }));
    cleanly('emotion failed', () => src.onEmotionDone({ status: 'failed', requestId: 'r2' }));
    cleanly('system', () => src.onSystemNotice({ id: 's1', title: '', message: 'Disk almost full', level: 'warning' }));
    cleanly('api key', () => src.onApiKeyStatus({ NovelAI: [{ index: 0, apiKey: { state: 'fail', message: '' } }] }));
    cleanly('api lock', () => src.onApiServiceLock({ service: 'nai', label: '', lock: { reason: '' } }));
    cleanly('text', () => src.onTextEvent({ event: 'message', accountId: 'tm1', chatGuid: 'c1', notify: true, message: { guid: 'g1', date: now, text: '', attachments: [], sender: { name: 'Ann', address: '+1555' } } }));
    cleanly('text sign-in lost', () => src.onTextEvent({ event: 'signin_lost', accountId: 'tm1' }));
    cleanly('chat reply', () => src.onChatReply({ chatId: 7, session: { character_name: 'Chiyo' }, raw: JSON.stringify([{ type: 'speech', content: 'Hello' }]), clientInfo: { userType: 'admin', as: { kind: 'device' } }, ws: { readyState: 1 } }));
    cleanly('print failed', () => src.onPrintJob({ owner: 'Melaton Mobile', status: 'failed', jobId: 'j1', userType: 'admin', error: { message: '' } }));
    cleanly('rain', () => src.onRainAlarm({ place: { id: 'home', label: 'Home' }, startsInMin: 0, kind: 'Rain' }));
    cleanly('xm recording', () => src.onXmRecording({ id: 'e1', state: 'running' }, ''));
    cleanly('xm missed', () => src.onXmRecording({ id: 'e2', state: 'missed' }, 'Ch 1'));
    cleanly('weather alert', () => src.onWeatherAlert({ alert: { id: 'a1', title: 'Wind Advisory', severity: 'moderate', expires: '2026-11-28T21:00' }, place: { id: 'home', label: 'Home', name: 'Jersey City' } }));
    cleanly('director start', () => src.onDirectorStatus({ running: true, sessionId: 's1', sessionName: 'Morning' }));
    cleanly('director done', () => src.onDirectorStatus({ running: false, sessionId: null, sessionName: null }));
    const ids = stored().map((n) => n.id);
    for (const want of ['stack:mail', 'question:f1', 'question:f2', 'emotion:r1', 'emotion:r2', 'system:s1', 'api-key:NovelAI', 'api-key:nai', 'sms:tm1:c1', 'tm-signin:tm1', 'chat:7', 'print:j1', 'rain:home', 'xmrec:e1', 'xmrec:e2', 'wx:a1', 'director:s1:turn']) {
        assert.ok(ids.includes(want), `${want} registered (have ${ids.join(', ')})`);
    }
    // every one of them has what the guard asks (a body and a call to action), seen from the stored rows
    for (const n of stored().filter((x) => !/^stack:/.test(x.id))) assert.strictEqual(inbox.noticeGap(n), '', `${n.id}: ${n.title} / ${n.text}`);
});

test('fleetNotices: work done / needs you / stopped, the login notice and a routine notice', () => {
    const sup = require('../modules/agentSupervisor');
    const fn = require('../modules/fleetNotices');
    sup.bind(gr);
    const row = (over) => Object.assign({ id: 41, title: 'Fix the bar', state: 'done', message: 'Done', parent_id: null, joined_into: null, source: 'fleet', input_questions: null, ended_at: 1 }, over);
    cleanly('done', () => assert.strictEqual(fn.workChanged(row({}), 'running', 5), 'done'));
    cleanly('done, a long message', () => fn.workChanged(row({ id: 42, message: `Landed. ${'x '.repeat(300)}` }), 'running', 5));
    cleanly('stopped', () => assert.strictEqual(fn.workChanged(row({ id: 43, state: 'failed', message: '' }), 'running', 5), 'attention'));
    cleanly('needs you, no questions', () => assert.strictEqual(fn.workChanged(row({ id: 44, state: 'input', message: '' }), 'running', 5), 'attention'));
    cleanly('needs you, a question', () => fn.workChanged(row({ id: 45, state: 'input', input_questions: JSON.stringify([{ question: 'Ship it?', answer: '' }]) }), 'running', 5));
    cleanly('login', () => assert.strictEqual(fn.accountLogin({ index: 2, id: 'acc2', name: 'Claude 3', since: 1 }, gr), true));
    const rows = stored();
    for (const id of ['fleet-work:41:done', 'fleet-work:42:done', 'fleet-work:43:attention', 'fleet-work:44:attention', 'fleet-work:45:attention', 'fleet-account:acc2:login']) {
        const hit = rows.flatMap((n) => (n.data && Array.isArray(n.data.items) ? n.data.items : [n])).find((x) => x.id === id);
        assert.ok(hit, `${id} registered`);
        assert.ok(String(hit.text).trim(), `${id}: a body`);
        assert.ok(hit.actions.length && hit.data.app === 'claudedesk', `${id}: Open key and a tap target`);
    }
});

test('fleetNotices.routine: maintenance, usage flag and app update shapes (their producers\' own), and one with no text at all', async () => {
    const sup = require('../modules/agentSupervisor');
    const fn = require('../modules/fleetNotices');
    sup.bind(gr);
    await sup.saveSettings(gr, { notify: { maintenance: true, usage: true, appUpdate: true } });
    reset();
    const shapes = {
        maintenance: { id: 'fleet-maintenance:2026-11-27', title: 'Fleet maintenance: needs a look', text: 'Disk: 91% full', data: { app: 'claudedesk', kind: 'maintenance', runId: 3 }, ttlMs: 172800000 },
        usage: { id: 'usage-flag:k1', title: 'Heavy usage: Item', text: 'Used 40% of the week in a day', data: { app: 'claudedesk', kind: 'usage-flag', sessionId: 's', reason: 'burn' }, ttlMs: 259200000 },
        appUpdate: { id: 'app-update-waiting:d1:90', alert: false, title: 'A53: update 1.2 waits', text: 'Not installed. It installs by itself when Shizuku or ADB 5555 is back.', data: { app: 'claudedesk', kind: 'app-update-waiting', deviceId: 'd1', versionCode: 90, page: 'devices' }, ttlMs: 14400000 },
    };
    for (const [kind, n] of Object.entries(shapes)) assert.strictEqual(cleanly(kind, () => fn.routine(kind, n)).published, true, kind);
    assert.strictEqual(cleanly('bare routine', () => fn.routine('maintenance', { id: 'fleet-maintenance:bare', title: 'Bare', data: {} })).published, true);
    assert.strictEqual(stored().length, 4);
});

test('deviceConsentNotices: the phone ask and the in-use notice', () => {
    const cn = require('../modules/deviceConsentNotices');
    cn._reset();
    const r = cleanly('consent', () => cn.sync({ asks: [{ leaseId: 'L9', device: 'a53', label: 'A53 phone', agentId: 'ag1', agentName: 'Claude 3', why: '', minutes: 5, requestedAt: now, consentSince: now }], holds: [{ leaseId: 'L8', device: 'fold', label: 'Fold', agentId: 'ag2', agentName: 'Claude 4', why: '', startedAt: now, endsAt: now + 30 * 60000 }] }, {}, {}));
    assert.deepStrictEqual(r.published.sort(), ['device-ask:L9', 'device-hold:fold']);
});

test('the other publishers\' shapes, built the way they build them: reminders, Lapis, Traffic, Videos, Kick, Plaud, call summary, Ingest', () => {
    const pub = (what, n) => cleanly(what, () => assert.ok(inbox.publish(n), `${what} published`));
    // modules/reminderScheduler.js: an appointment and a task (text lines: subject, when, location; actions dismiss / snooze)
    pub('reminder', { user: 'admin', id: 'rem:f1:u1:1', app: 'calendar', cls: 'reminder', title: '9:00 AM | Reminder', text: ['No Subject', 'Today 9:00 AM'].join('\n'), actions: ['dismiss', 'snooze'], data: { app: 'calendar', kind: 'reminder', uid: 'u1', start: 1 }, expiresAt: now + 3600000 });
    pub('task reminder', { user: 'admin', id: 'rem:task:t1:1', app: 'tasks', cls: 'reminder', title: '9:00 AM | Reminder', text: 'No Subject', actions: ['dismiss', 'snooze'], data: { app: 'tasks', kind: 'reminder', task: true, uid: 't1' }, expiresAt: now + 86400000 });
    // modules/lapisService.js notice(): title, text, ['lock' | 'view' | 'stop'], data.app lapis
    pub('lapis', { app: 'lapis', id: 'lapis:unlocked', cls: 'lapis-unlocked', title: 'The car is unlocked', text: 'Parked for 10 minutes with the doors unlocked. Lock it now?', actions: ['lock'], alert: true, data: { app: 'lapis', kind: 'unlocked', stamp: 'parked-1', open: null } });
    // modules/trafficService.js runScheduled: with a report, and the fallback text
    pub('traffic', { app: 'traffic', id: 'traffic:scheduled:home:2026-11-27', cls: 'notification', title: 'Home: 25 min', text: 'Light traffic.', actions: ['view'], data: { app: 'traffic', direction: 'home', open: 'home' }, ttlMs: 10800000 });
    pub('traffic, no report', { app: 'traffic', id: 'traffic:scheduled:work:2026-11-27', cls: 'notification', title: 'Work', text: 'Could not check the traffic.', actions: ['view'], data: { app: 'traffic', direction: 'work', open: 'work' }, ttlMs: 10800000 });
    // modules/youtubeService.js tellUploads / modules/ws/handlers/308-youtubeHandler.js Kick live: title text, actions [], data.app youtube
    pub('video upload', { app: 'youtube', id: 'videos:upload:v1', cls: 'notification', alert: true, title: 'A channel uploaded', text: 'The new video', actions: [], data: { app: 'youtube', open: 'yt:v1' }, ttlMs: 86400000 });
    pub('kick live', { app: 'youtube', id: 'videos:live:c1', cls: 'notification', alert: true, title: 'C1 is live on Kick', text: 'Stream title', actions: [], digest: 'kick|c1|1', data: { app: 'youtube', open: 'kick:c1' }, ttlMs: 7200000 });
    // modules/plaudDevice.js ask
    pub('plaud', { app: 'plaud', id: 'plaud:sign-in', cls: 'notification', title: 'Plaud', text: 'Sign in at Plaud in the server\'s browser.', actions: [], data: { app: 'plaud' } });
    // modules/callFilter.js summarize
    pub('call summary', { user: 'admin', app: 'phone', id: 'callsummary', cls: 'notification', alert: false, title: 'While you were away', text: '2 missed notifications', ttlMs: 86400000, data: { app: 'phone', kind: 'callsummary', counts: {} } });
    // modules/ingestController.js publishNotice (_text is always "From ...: ..." or the code lines)
    pub('ingest', { app: 'ingest', id: 'ingest:rule:abc', cls: 'notification', title: 'Mail rule', text: 'From Ann: Invoice', data: { app: 'ingest', kind: 'rule' }, ttlMs: 86400000, alert: true });
});

(async () => {
    for (const [name, f] of tests) {
        try { reset(); await f(); passed += 1; console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 7).join('\n     ')}`); }
    }
    faults.capture = realCapture;
    fs.rmSync(tmp, { recursive: true, force: true });
    if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
    console.log(`test-notification-inbox-guard: ${passed} tests passed`);
    process.exit(0);
})();
