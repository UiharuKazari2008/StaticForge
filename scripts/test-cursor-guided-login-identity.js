#!/usr/bin/env node
// Regression: a captured browser login (subject-only "github|..." identity) must read as logged in:
// session kept next to the minted key, identity label shown, key-only usage not flagged as expired login.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.join(__dirname, '..');
const store = require(path.join(root, 'modules/cursorAccountAuthStore'));
const id = `zz-guided-test-${process.pid}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'none' })}.${b64({ sub: 'github|user_01TEST', exp: 9999999999 })}.sig`;
const KEY = 'crsr_' + 'a'.repeat(64);
const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(/CreateUserApiKey/.test(url) ? { apiKey: KEY } : { apiKeys: [] }) });
(async () => {
  const data = { accounts: [{ id, name: 'T', email: '(Pending Login)', isEmpty: true }] };
  try {
    const r = await store.recordGuidedLogin(data, id, { accessToken: jwt, refreshToken: 'r1' }, { fetchImpl });
    assert.strictEqual(r.provisionError, null);
    const auth = JSON.parse(fs.readFileSync(path.join(store.getAccountDir(id), 'auth.json'), 'utf8'));
    assert.strictEqual(auth.apiKey, KEY, 'minted key stored');
    assert.strictEqual(auth.accessToken, jwt, 'browser session kept');
    assert.strictEqual(auth.refreshToken, 'r1');
    const acc = data.accounts[0];
    assert.strictEqual(acc.isEmpty, false);
    assert.strictEqual(acc.email, 'github|user_01TEST');
    const pub = store.publicCursorAccount(acc);
    assert.strictEqual(pub.email, '');
    assert.strictEqual(pub.identity, 'GitHub user_01TEST');
    assert.strictEqual(pub.isEmpty, false);
    assert.strictEqual(store.accountIdentityLabel({ email: '(Pending Login)' }), '');
    assert.strictEqual(store.accountIdentityLabel({ email: 'a@b.co' }), 'a@b.co');
    // UI rule from securityCenterDsapApplet.js
    const usageTitle = 'Usage needs a browser session (API key is active)';
    const loginNeeded = !!(pub.isEmpty || /pending login/i.test(pub.email || '') || /expired|not logged|login|unauthorized/i.test(usageTitle));
    assert.strictEqual(loginNeeded, false);
    const src = fs.readFileSync(path.join(root, 'modules/cursorUsage.js'), 'utf8');
    assert.ok(src.includes(usageTitle), 'usage title for key-only accounts');
    console.log('PASS guided login shows as logged in with subject identity');
  } finally {
    fs.rmSync(store.getAccountDir(id), { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
