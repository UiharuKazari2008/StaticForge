#!/usr/bin/env node
'use strict';
// Wren list and sandbox tray: newest activity first, TokenRouter chats included.
const assert = require('assert');
const d = require('../modules/cursorDirector');
const t = d._test;
const day = (n) => new Date(Date.UTC(2026, 9, n)).toISOString();
const user = (n) => ({ role: 'user', message_type: 'Ask', timestamp: day(n) });
const index = { chats: [
    { id: 'dirc_tr_old', cursorId: null, lastEngine: 'tokenrouter', model: 'minimax/minimax-m3.1-flash',
        choice: { engine: 'tokenrouter', id: 'minimax/minimax-m3.1-flash' }, claudeSessionId: 'x',
        created_at: day(12), updated_at: day(19), messages: [user(19), { role: 'assistant' }] },
    { id: 'dirc_c1', cursorId: 'c1', lastEngine: 'cursor', created_at: day(13), updated_at: day(13), messages: [] },
    { id: 'dirc_c2', cursorId: 'c2', created_at: day(14), updated_at: day(14), messages: [] },
    { id: 'dirc_c3', cursorId: 'c3', created_at: day(15), updated_at: day(15), messages: [] },
    { id: 'dirc_hidden', dynagen: true, created_at: day(18), updated_at: day(18), messages: [user(18)] }
] };
const listed = t.listedChatsByActivity(index).map((c) => c.id);
assert.deepStrictEqual(listed, ['dirc_tr_old', 'dirc_c3', 'dirc_c2', 'dirc_c1']);
const tray = t.traySessions(index, null);
assert.strictEqual(tray.length, 3);
assert.strictEqual(tray[0].id, 'dirc_tr_old', 'recently active TokenRouter chat is in the tray');
assert.strictEqual(tray[0].engine, 'tokenrouter');
assert.strictEqual(tray[0].model, 'minimax/minimax-m3.1-flash');
const pub = t.publicSession(index.chats[0]);
assert.strictEqual(pub.engine, 'tokenrouter');
assert.strictEqual(pub.model, 'minimax/minimax-m3.1-flash');
assert.strictEqual(pub.running, false);
// No lastEngine yet: fall back to the picked engine.
assert.strictEqual(t.publicSession({ id: 'x', choice: { engine: 'tokenrouter', id: 'a/b' }, messages: [] }).engine, 'tokenrouter');
console.log('test-director-session-list: ok');
process.exit(0);
