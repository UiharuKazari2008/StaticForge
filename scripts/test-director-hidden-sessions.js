// Enhance with Director on: a hidden Rentan/Quips chat must never be opened by image or metadata lookup.
const assert = require('assert');
const t = require('../modules/cursorDirector')._test;
const index = { chats: [
    { id: 'normal', cursorId: 'c1', workspaceId: 'w', filename: 'a.png', messages: [] },
    { id: 'rentan', dynagen: true, cursorId: 'c2', workspaceId: 'w', filename: 'b.png', images: ['b.png'], messages: [] },
    { id: 'quips', quips: true, cursorId: 'c3', workspaceId: 'w', images: ['c.png'], messages: [] }
] };
assert.strictEqual(t.chatIsHidden(index.chats[1]), true);
assert.strictEqual(t.chatIsHidden(index.chats[0]), false);
assert.strictEqual(t.pickOpenWorkspaceChat(index, { previewFilename: 'b.png' }, 'w'), null);
assert.strictEqual(t.pickOpenWorkspaceChat(index, { previewFilename: 'c.png' }, 'w'), null);
assert.strictEqual(t.pickOpenWorkspaceChat(index, { previewFilename: 'x.png', directorSessionId: 'rentan' }, 'w'), null);
assert.strictEqual(t.pickOpenWorkspaceChat(index, { previewFilename: 'a.png' }, 'w').id, 'normal');
assert.strictEqual(t.pickOpenWorkspaceChat(index, { directorSessionId: 'normal' }, 'w').id, 'normal');
assert.strictEqual(t.pickOpenWorkspaceChat(index, { preferredChatId: 'rentan' }, 'w').id, 'rentan', 'carousel opens Rentan by id');
console.log('test-director-hidden-sessions: ok');
process.exit(0);
