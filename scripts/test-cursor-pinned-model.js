#!/usr/bin/env node
'use strict';
// Pinned Cursor model: each switch writes the role's model in the CLI's own format
// (model + selectedModel + modelParameters[base]) and touches nothing else.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-pinned-model-'));
process.env.DREAMSCAPE_CURSOR_ACCOUNTS_DIR = path.join(SANDBOX, 'accounts');
process.env.DREAMSCAPE_HOST_CURSOR_DIR = path.join(SANDBOX, 'host');
process.on('exit', () => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const root = path.join(__dirname, '..');
const cwd = process.cwd(); process.chdir(SANDBOX);
const store = require(path.join(root, 'modules/cursorAccountAuthStore'));
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const eff = c => Object.fromEntries(c.selectedModel.parameters.map(p => [p.id, p.value]));
// Format matches what the CLI itself wrote for `--model grok-4.7-high`.
const hi = store.resolveCliModel('grok-4.7-high');
assert.strictEqual(hi.base, 'grok-4.7');
assert.deepStrictEqual(hi.parameters, [{ id: 'context', value: '256k' }, { id: 'reasoning_effort', value: 'high' }, { id: 'fast', value: 'false' }]);
assert.strictEqual(hi.model.displayName, 'Grok 4.7 256K High');
assert.strictEqual(store.resolveCliModel('grok-4.7-high-fast').parameters[2].value, 'true');
assert.strictEqual(store.getPinnedModel().id, 'grok-4.7-high');
assert.strictEqual(store.getPinnedModel('director').id, 'grok-4.7-high-fast');
const d = store.getAccountDir('lite'); fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ accessToken: 't' }));
const perms = { allow: ['Shell(ls)'], deny: [] };
fs.writeFileSync(path.join(d, 'cli-config.json'), JSON.stringify({ authInfo: { email: 'x' }, permissions: perms, approvalMode: 'allowlist', model: { modelId: 'default', displayModelId: 'auto' }, modelParameters: { default: [] } }));
store.syncHostCursorLogin('lite');
const host = read(path.join(SANDBOX, 'host', 'cli-config.json'));
assert.strictEqual(host.model.modelId, 'grok-4.7');
assert.strictEqual(host.selectedModel.modelId, 'grok-4.7');
assert.deepStrictEqual(eff(host), { context: '256k', reasoning_effort: 'high', fast: 'false' }, 'host pins High');
assert.deepStrictEqual(host.modelParameters.default, [], 'other model params kept');
assert.deepStrictEqual(host.permissions, perms, 'permissions untouched');
assert.strictEqual(host.approvalMode, 'allowlist', 'approval mode untouched');
const jail = path.join(SANDBOX, 'wren'); store.restoreAccountAuthFiles('lite', jail);
const wren = read(path.join(jail, 'cli-config.json'));
assert.strictEqual(eff(wren).fast, 'true', 'Wren jail pins Fast');
assert.strictEqual(wren.model.displayName, 'Grok 4.7 256K High Fast');
assert.strictEqual(store.applyPinnedModel(path.join(jail, 'cli-config.json'), store.getPinnedModel('director')), false, 'idempotent');
fs.writeFileSync(path.join(SANDBOX, 'secure.config.json'), JSON.stringify({ cursorAccounts: { pinnedModel: 'grok-4.7-xhigh', directorPinnedModel: 'grok-4.7-medium-fast' } }));
assert.strictEqual(store.getPinnedModel().parameters[1].value, 'xhigh', 'xi override');
assert.strictEqual(store.getPinnedModel('director').id, 'grok-4.7-medium-fast', 'director override is separate');
fs.writeFileSync(path.join(SANDBOX, 'secure.config.json'), JSON.stringify({ cursorAccounts: { pinnedModel: false } }));
assert.strictEqual(store.getPinnedModel(), null, 'false disables pinning');
assert.strictEqual(store.getPinnedModel('director').id, 'grok-4.7-high-fast');
process.chdir(cwd);
console.log('test-cursor-pinned-model: ok');
