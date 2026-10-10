#!/usr/bin/env node
// Host ~/.config/cursor follows the Xi account: atomic, mode 600, previous auth kept as .bak. Temp dirs only.
'use strict';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-host-sync-'));
process.env.DREAMSCAPE_CURSOR_ACCOUNTS_DIR = path.join(SANDBOX, 'accounts');
process.env.DREAMSCAPE_HOST_CURSOR_DIR = path.join(SANDBOX, 'host');
process.on('exit', () => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const root = path.join(__dirname, '..');
const xiDirector = require(path.join(root, 'modules/xiDirector'));
const xiDir = path.join(SANDBOX, 'xi'); fs.mkdirSync(xiDir);
const real = typeof xiDirector.layout === 'function' ? xiDirector.layout() : {};
xiDirector.layout = () => ({ ...real, configDir: xiDir });
const store = require(path.join(root, 'modules/cursorAccountAuthStore'));
assert.strictEqual(store.hostCursorConfigDir(), path.join(SANDBOX, 'host'));
const put = (id, auth, email) => {
  const d = store.getAccountDir(id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify(auth));
  fs.writeFileSync(path.join(d, 'cli-config.json'), JSON.stringify({ authInfo: { email } }));
};
put('a', { accessToken: 'tok.a.1' }, 'grok|a');
put('b', { accessToken: 'tok.b.1' }, 'github|b');
put('empty', {}, '(Logged Out)');
const host = path.join(SANDBOX, 'host');
fs.mkdirSync(host); fs.writeFileSync(path.join(host, 'auth.json'), '{"accessToken":"clobbered"}');
let r = store.syncHostCursorLogin('a');
assert.strictEqual(r.synced, true);
const hostAuth = () => JSON.parse(fs.readFileSync(path.join(host, 'auth.json'), 'utf8'));
assert.strictEqual(hostAuth().accessToken, 'tok.a.1');
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(host, 'auth.json.bak'), 'utf8')).accessToken, 'clobbered');
assert.strictEqual(fs.statSync(path.join(host, 'auth.json')).mode & 0o777, 0o600);
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(host, 'cli-config.json'), 'utf8')).authInfo.email, 'grok|a');
assert.strictEqual(store.syncHostCursorLogin('a').synced, false, 'no rewrite when unchanged');
assert.strictEqual(store.syncHostCursorLogin('empty').synced, false, 'never write an empty login');
assert.strictEqual(hostAuth().accessToken, 'tok.a.1');
// Switching Xi (restore into the Xi config dir) moves the host login too; Wren dirs do not.
store.restoreAccountAuthFiles('b', path.join(SANDBOX, 'wren'));
assert.strictEqual(hostAuth().accessToken, 'tok.a.1', 'Wren switch leaves host alone');
store.restoreAccountAuthFiles('b', xiDir);
assert.strictEqual(hostAuth().accessToken, 'tok.b.1', 'Xi switch updates host');
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(host, 'auth.json.bak'), 'utf8')).accessToken, 'tok.a.1');
assert.ok(!fs.readdirSync(host).some((n) => n.includes('.tmp-')), 'no temp files left');
console.log('PASS host Cursor login follows the Xi account');
