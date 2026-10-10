#!/usr/bin/env node
// Per-profile Logout clears that profile only; DSAP form has the logout button, colour picker and copy row.
'use strict';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-profile-logout-'));
process.env.DREAMSCAPE_CURSOR_ACCOUNTS_DIR = path.join(SANDBOX, 'accounts');
process.on('exit', () => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const root = path.join(__dirname, '..');
const store = require(path.join(root, 'modules/cursorAccountAuthStore'));
assert.ok(store.getAccountDir('x').startsWith(SANDBOX));
const KEY = 'crsr_' + 'b'.repeat(64);
const write = (id, auth, info) => {
  const d = store.getAccountDir(id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify(auth));
  fs.writeFileSync(path.join(d, 'cli-config.json'), JSON.stringify({ keep: 1, authInfo: info }));
};
write('heavy', { apiKey: KEY, accessToken: 'a.b.c', refreshToken: 'r' }, { email: 'github|u1', displayName: 'Y' });
write('lite', { accessToken: 'd.e.f' }, { email: 'grok|u2', displayName: 'L' });
const data = { accounts: [
  { id: 'heavy', name: 'Heavy', email: 'github|u1', token: KEY, tokenKind: 'apiKey', apiKey: KEY, accessToken: 'a.b.c', isEmpty: false },
  { id: 'lite', name: 'Lite', email: 'grok|u2', token: 'd.e.f', tokenKind: 'accessToken', isEmpty: false }
] };
const r = store.clearAccountProfileAuth(data, 'heavy');
assert.strictEqual(r.hadApiKey, true); assert.strictEqual(r.accessToken, 'a.b.c');
const read = (id, f) => JSON.parse(fs.readFileSync(path.join(store.getAccountDir(id), f), 'utf8'));
assert.deepStrictEqual(read('heavy', 'auth.json'), {});
assert.strictEqual(read('heavy', 'cli-config.json').authInfo.email, '(Logged Out)');
assert.strictEqual(read('heavy', 'cli-config.json').keep, 1);
const h = data.accounts[0];
assert.strictEqual(h.token, ''); assert.strictEqual(h.isEmpty, true);
assert.ok(!('apiKey' in h) && !('accessToken' in h));
assert.strictEqual(read('lite', 'auth.json').accessToken, 'd.e.f', 'other profile untouched');
assert.strictEqual(data.accounts[1].token, 'd.e.f');
const ui = fs.readFileSync(path.join(root, 'public/scripts/comp/securityCenterDsapApplet.js'), 'utf8');
assert.ok(ui.includes('data-sec-action="logout-cursor-profile"'));
assert.ok(ui.includes("'logout_cursor_account_profile'"));
assert.ok(/_logoutCursorProfile[\s\S]*?_loadCursorAccounts\(root\)/.test(ui), 'logout refreshes the list');
assert.ok(ui.includes('type="color" id="secCursorAccountColorPicker"'));
assert.ok(ui.includes('class="sec-token-row"'));
assert.ok(!ui.includes('The browser blocked the tab'), 'no false blocked-tab toast');
const h190 = fs.readFileSync(path.join(root, 'modules/ws/handlers/190-adminHandler.js'), 'utf8');
assert.ok(h190.includes("reg('logout_cursor_account_profile', handleLogoutCursorAccountProfile"));
console.log('PASS per-profile logout + DSAP account form fixes');
