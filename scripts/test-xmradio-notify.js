#!/usr/bin/env node
'use strict';
// A schedule set to Notify (Lizumi S5, #1252): its recording starting, or its entry missed, raises one notice; a schedule
// without Notify raises none; the first deck after a connect is only the baseline (a restart repeats nothing).
const assert = require('assert');
const src = require('../modules/notificationInboxSources');
const got = [];
src.onXmRecording = (e) => got.push([e.id, e.state]);
const T = require('../modules/xmRadioRecorderClient')._test;
const old = { id: 'c', state: 'running', notify: true };
const run = { id: 'a', state: 'running', notify: true };
const quiet = { id: 'b', state: 'running' };
T.resetNotices();
T.noticeEntries({ jobs: [old], history: [] });
assert.deepStrictEqual(got, [], 'the first deck is the baseline');
T.noticeEntries({ jobs: [old, run, quiet], history: [] });
assert.deepStrictEqual(got, [['a', 'running']], 'only the new entry set to Notify');
T.noticeEntries({ jobs: [old, run, quiet], history: [] });
assert.strictEqual(got.length, 1, 'once per entry and state');
T.noticeEntries({ jobs: [old], history: [{ id: 'm', state: 'missed', notify: true, reason: 'No virtual radio came free' }] });
assert.deepStrictEqual(got[1], ['m', 'missed'], 'a missed entry set to Notify says so');
console.log('test-xmradio-notify: ok');
