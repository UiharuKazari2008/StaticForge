#!/usr/bin/env node
// Control Panel's User Accounts (Yukimi 2026-10-13): Administrator and Guest, their passwords
// (PINs), Guest on / off, account pictures from Vista's defaults or an upload.
// Run: node scripts/test-user-accounts.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pics = require('../modules/accountPictures.js');

// server: defaults, choices, uploads
let d = pics.describe({});
assert.strictEqual(d.administrator.picture, 'kitten');
assert.strictEqual(d.guest.picture, 'guest');
assert.strictEqual(d.administrator.url, '/static_images/account-pictures/kitten.png');
d = pics.describe({ accountPictures: { administrator: 'dog', guest: 'nonsense' } });
assert.strictEqual(d.administrator.picture, 'dog');
assert.strictEqual(d.guest.picture, 'guest', 'unknown choices fall back to the default');
assert.strictEqual(pics.applyChange('guest', 'chess'), 'chess');
assert.throws(() => pics.applyChange('root', 'dog'), /Unknown account/);
assert.throws(() => pics.applyChange('guest', 'cat'), /Unknown picture/);
assert.throws(() => pics.applyChange('guest', 'custom', 'data:image/jpeg;base64,AAAA'), /PNG/);
assert.throws(() => pics.applyChange('guest', 'custom', 'data:image/png;base64,AAAAAAAAAAAA'), /PNG/, 'the bytes must be a PNG too');
for (const name of pics.DEFAULT_PICTURES) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/account-pictures', `${name}.png`)), `${name}.png`);
}
const handler = read('modules/ws/handlers/270-accountPicturesHandler.js');
assert.ok(handler.includes("reg('get_account_pictures', handleGet);") && handler.includes("reg('set_account_picture', handleSet, { destructive: true });"));
assert.ok(/handleSet[\s\S]*clientInfo\.userType !== 'admin'/.test(handler), 'only an administrator changes pictures');

// client: the tiles read like Vista's
global.window = global;
global.localStorage = { getItem: () => 'admin' };
const ua = require('../public/scripts/comp/cplUserAccounts.js');
const pins = { adminPinConfigured: true, userPinConfigured: false, userPinLoginEnabled: false };
const tiles = { administrator: { picture: 'kitten', url: '/static_images/account-pictures/kitten.png' }, guest: { picture: 'guest', url: '/static_images/account-pictures/guest.png' } };
const admin = ua._test.tile('administrator', pins, tiles);
assert.ok(admin.includes('Password protected') && admin.includes('data-cpl-ua-account="administrator"'));
const guest = ua._test.tile('guest', pins, tiles);
assert.ok(guest.includes('Guest account is off') && guest.includes('is-off'), 'the guest account reads off');
const guestView = ua._test.view('account', { account: 'guest' }, pins, tiles);
assert.ok(guestView.includes('Turn on the guest account') && guestView.includes('Create a password'), "Vista's account tasks");
const picView = ua._test.view('picture', { account: 'administrator', picture: 'dog' }, pins, tiles);
assert.ok(picView.includes('Browse for more pictures...') && picView.includes('data-cpl-ua-picture="dog"'));

const ws = read('public/scripts/websocket.js');
assert.ok(ws.includes("this.sendMessage('get_account_pictures'") && ws.includes("this.sendMessage('set_account_picture'"));
assert.ok(read('public/scripts/comp/featureLoader.js').includes("'scripts/comp/cplUserAccounts.js'"));
assert.ok(read('public/css/melaton-network.css').includes('#melatonControlPanelModal .cpl-ua-tile {'));

console.log('test-user-accounts: ok');
