#!/usr/bin/env node
'use strict';
// Pinned Cursor model: every switch writes one model, touching only the `model` field.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-pinned-model-'));
process.env.DREAMSCAPE_CURSOR_ACCOUNTS_DIR = path.join(SANDBOX, 'accounts');
process.env.DREAMSCAPE_HOST_CURSOR_DIR = path.join(SANDBOX, 'host');
process.on('exit', () => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const root = path.join(__dirname, '..');
const cwd = process.cwd(); process.chdir(SANDBOX); // no secure.config.json -> default pin
const store = require(path.join(root, 'modules/cursorAccountAuthStore'));
assert.strictEqual(store.getPinnedModel().modelId, 'grok-4.7-high');
assert.strictEqual(store.getPinnedModel().maxMode, false);
const d = store.getAccountDir('lite'); fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ accessToken: 't' }));
const perms = { allow: ['Shell(ls)'], deny: [] };
fs.writeFileSync(path.join(d, 'cli-config.json'), JSON.stringify({ authInfo: { email: 'x' }, permissions: perms, model: { modelId: 'default', displayModelId: 'auto' } }));
store.syncHostCursorLogin('lite');
const host = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'host', 'cli-config.json'), 'utf8'));
assert.strictEqual(host.model.modelId, 'grok-4.7-high', 'host switch pins model');
assert.deepStrictEqual(host.permissions, perms, 'permissions untouched');
assert.strictEqual(host.authInfo.email, 'x');
const jail = path.join(SANDBOX, 'wren'); store.restoreAccountAuthFiles('lite', jail);
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(jail, 'cli-config.json'), 'utf8')).model.modelId, 'grok-4.7-high-fast', 'Wren jail switch pins Fast');
assert.strictEqual(store.applyPinnedModel(path.join(jail, 'cli-config.json'), store.getPinnedModel('director')), false, 'idempotent');
assert.strictEqual(host.model.modelId, 'grok-4.7-high', 'host stays High');
fs.writeFileSync(path.join(SANDBOX, 'secure.config.json'), JSON.stringify({ cursorAccounts: { pinnedModel: 'other-model' } }));
assert.strictEqual(store.getPinnedModel().modelId, 'other-model', 'string override');
assert.strictEqual(store.getPinnedModel('director').modelId, 'grok-4.7-high-fast', 'director setting is separate');
fs.writeFileSync(path.join(SANDBOX, 'secure.config.json'), JSON.stringify({ cursorAccounts: { directorPinnedModel: 'wren-x' } }));
assert.strictEqual(store.getPinnedModel('director').modelId, 'wren-x', 'director override');
assert.strictEqual(store.getPinnedModel().modelId, 'grok-4.7-high', 'xi unaffected by director override');
fs.writeFileSync(path.join(SANDBOX, 'secure.config.json'), JSON.stringify({ cursorAccounts: { pinnedModel: false } }));
assert.strictEqual(store.getPinnedModel(), null, 'false disables pinning');
process.chdir(cwd);
console.log('test-cursor-pinned-model: ok');
