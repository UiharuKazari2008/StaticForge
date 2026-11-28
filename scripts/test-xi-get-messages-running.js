'use strict';
// #1319: opening a running Yozora chat carries the running turn's draft (the reply so far), like Wren's
// director_get_messages does; a sinceId that is the draft is no anchor (the whole chat comes back).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'xi-get-messages-'));
const { getMessagesReply } = require('../modules/xiDirector')._test;

const chat = {
    id: 'c1',
    name: 'Fix it',
    messages: [
        { id: 'u1', role: 'user', content: 'go', timestamp: '2026-11-28T01:00:00Z' },
        { id: 'a1', role: 'assistant', content: 'done', timestamp: '2026-11-28T01:01:00Z' },
        { id: 'u2', role: 'user', content: 'more', timestamp: '2026-11-28T01:02:00Z' },
        { id: 'draft1', role: 'assistant', content: 'working on it so far', timestamp: '2026-11-28T01:03:00Z' }
    ]
};

// a running turn: the draft is in the reply, in order
const open = getMessagesReply(chat, undefined, { draftId: 'draft1' });
assert.deepStrictEqual(open.messages.map((m) => m.id), ['u1', 'a1', 'u2', 'draft1'], 'fresh open of a running chat carries the draft');
assert.strictEqual(open.total, 4);
assert.ok(!open.partial, 'a fresh open is the whole chat');

// a page that holds up to u2 asks for what came after: the draft is in it
const since = getMessagesReply(chat, 'u2', { draftId: 'draft1' });
assert.deepStrictEqual(since.messages.map((m) => m.id), ['draft1'], 'since u2: the draft');
assert.strictEqual(since.partial, true);

// the draft as anchor is no anchor: the whole chat comes back (it has been written to since)
const draftAnchor = getMessagesReply(chat, 'draft1', { draftId: 'draft1' });
assert.deepStrictEqual(draftAnchor.messages.map((m) => m.id), ['u1', 'a1', 'u2', 'draft1'], 'the draft is no sinceId anchor');
assert.ok(!draftAnchor.partial);

// no run: unchanged
const idle = getMessagesReply({ ...chat, messages: chat.messages.slice(0, 2) }, 'u1', null);
assert.deepStrictEqual(idle.messages.map((m) => m.id), ['a1']);

console.log('test-xi-get-messages-running: ok');
process.exit(0);
