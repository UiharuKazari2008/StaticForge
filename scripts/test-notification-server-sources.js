#!/usr/bin/env node
'use strict';
// #908: notices only the server raises reach the phone page or no page: the household mailbox (dmail:), Director
// questions (question:), eMotion (emotion:), warnings (system:), API keys (api-key:); each clears when done. A new text's
// notice carries the conversation for the app's MessagingStyle notification (its one path; tm.notify is gone).
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
const activeSync = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');
const src = require('../modules/notificationInboxSources');

const toPhones = [];
activeSync.sendInboxNotice = (_g, _w, n) => { toPhones.push(n); return 1; };
activeSync.sendInboxCleared = () => 1;
inbox.bind({ getWebSocketServer: () => ({ broadcast: () => {} }) });
const state = (id) => { const n = inbox.list('admin', { includeCleared: true }).find((x) => x.id === id); return n && n.state; };

// household mailbox: yukimi's inbox only
src.onDovecoteNewMail({ mailbox: 'yukimi', id: 42, from: '"Rook" <rook@x>', subject: 'Report' });
src.onDovecoteNewMail({ mailbox: 'rook', id: 43, from: 'a', subject: 'b' });
assert.strictEqual(state('dmail:42'), 'new');
assert.strictEqual(state('dmail:43'), undefined, "a bot's mailbox is not the phone's");
assert.ok(/From: Rook\nReport/.test(toPhones.find((n) => n.id === 'dmail:42').text));
src.onDovecoteDone(42);
assert.strictEqual(state('dmail:42'), 'cleared');

// questions
src.onQuestion({ id: 'f1', title: 'Which outfit?', fields: [{ label: 'Outfit' }] });
assert.strictEqual(state('question:f1'), 'new');
src.onQuestionClosed('f1');
assert.strictEqual(state('question:f1'), 'cleared');

// eMotion
src.onEmotionDone({ requestId: 'r9', status: 'running' });
assert.strictEqual(state('emotion:r9'), undefined, 'running is not news');
src.onEmotionDone({ requestId: 'r9', status: 'completed', sourceFilename: 'a.png' });
assert.strictEqual(toPhones.find((n) => n.id === 'emotion:r9').title, 'Animation ready');

// warnings only
src.onSystemNotice({ message: 'fyi', level: 'info' });
src.onSystemNotice({ id: 'disk', title: 'Disk', message: 'Disk almost full', level: 'warning' });
assert.strictEqual(state('system:disk'), 'new');
assert.strictEqual(inbox.list('admin').filter((n) => n.id.startsWith('system:')).length, 1, 'info is not posted');

// API keys: a failing key notifies, all ok clears
src.onApiKeyStatus({ novelai: [{ index: 0, apiKey: { state: 'fail', message: 'Unauthorized' } }] });
assert.strictEqual(state('api-key:novelai'), 'new');
src.onApiKeyStatus({ novelai: [{ index: 0, apiKey: { state: 'ok' } }] });
assert.strictEqual(state('api-key:novelai'), 'cleared');
src.onApiServiceLock({ service: 'openai', label: 'OpenAI', lock: { reason: 'Budget' } });
assert.strictEqual(state('api-key:openai'), 'new');
src.onApiServiceLock({ service: 'openai', lock: null });
assert.strictEqual(state('api-key:openai'), 'cleared');

// a new text carries its conversation
src.onTextEvent({ event: 'message', accountId: 'acct', chatGuid: 'c1', chatTitle: 'Mina', notify: true, message: { guid: 'g1', text: 'hi', sender: { name: 'Mina', address: '+1' }, date: 5 } });
const sms = toPhones.find((n) => n.id === 'sms:acct:c1');
assert.ok(sms && sms.data.kind === 'sms' && sms.data.title === 'Mina' && sms.data.sender === 'Mina' && sms.data.guid === 'g1');

console.log('test-notification-server-sources: ok');
process.exit(0);
