#!/usr/bin/env node
/**
 * modules/videosKickChat.js (Yozora #919) without Kick: a delivery's signature check, the subscription that lives
 * only while a panel is open, batches and thinning, the account link and a sent message, the gate's two openings.
 *
 *   node scripts/test-videos-kick-chat.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-chat-test-'));
process.env.VIDEOS_KICK_CHAT_FILE = path.join(tmp, 'chat.json');
process.env.VIDEOS_KICK_EMOTE_DIR = path.join(tmp, 'emotes');
process.env.VIDEOS_KICK_CHAT_LINGER_MS = '30';
const chat = require('../modules/videosKickChat');
const T = chat._test;

let pass = 0;
let failed = 0;
const tests = [];
const ok = (name, fn) => tests.push([name, fn]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const sign = (id, ts, body) => crypto.sign('RSA-SHA256', Buffer.from(`${id}.${ts}.${body}`), privateKey).toString('base64');

const calls = [];
let nextSub = 0;
const res = (status, body, type) => ({ status, headers: { get: () => type || 'application/json' }, json: async () => body, arrayBuffer: async () => body });
async function fakeFetch(url, opt = {}) {
    calls.push({ url: String(url), method: opt.method || 'GET', body: opt.body, auth: opt.headers && opt.headers.Authorization });
    const u = String(url);
    if (u.endsWith('/events/subscriptions') && opt.method === 'POST') { nextSub += 1; return res(200, { data: [{ name: JSON.parse(opt.body).events[0].name, version: 1, subscription_id: `sub${nextSub}` }] }); }
    if (u.includes('/events/subscriptions?') && opt.method === 'DELETE') return { status: 204, headers: { get: () => '' } };
    if (u.endsWith('/oauth/token')) return res(200, { access_token: 'user-access', refresh_token: 'user-refresh', expires_in: 3600, scope: 'chat:write' });
    if (u.endsWith('/chat')) return res(200, { data: { is_sent: true, message_id: 'm-1' } });
    if (u.includes('/emotes/')) return res(200, Buffer.from('RIFFxxxxWEBP'), 'image/webp');
    return res(404, null);
}

function fresh() {
    T.reset();
    calls.length = 0;
    try { fs.unlinkSync(process.env.VIDEOS_KICK_CHAT_FILE); } catch (_e) { /* none */ }
    chat.bind({
        key: () => ({ clientId: 'cid', secret: 'sec' }), appToken: async () => 'app-token',
        channel: (slug) => (slug === 'asmongold' ? { slug, name: 'Asmongold', userId: 77 } : null), bells: () => [], look: () => { fresh.looked = (fresh.looked || 0) + 1; },
        origin: () => 'https://example.test', fetch: fakeFetch
    });
    T.setKey(PEM);
}
const msg = (n) => ({ message_id: `id${n}`, broadcaster: { user_id: 77, channel_slug: 'asmongold' }, sender: { username: `u${n}`, identity: { username_color: '#FF5733', badges: [{ type: 'subscriber', text: 'Sub', count: 3 }] } }, content: `hello ${n} [emote:37226:KEKW]`, created_at: new Date().toISOString() });

ok('a delivery is taken only with Kick\'s signature over id.timestamp.body, and only when fresh', async () => {
    fresh();
    const ts = new Date().toISOString();
    const body = JSON.stringify(msg(1));
    assert.strictEqual(await T.verify('A1', ts, Buffer.from(body), sign('A1', ts, body)), true);
    assert.strictEqual(await T.verify('A1', ts, Buffer.from(`${body} `), sign('A1', ts, body)), false, 'a changed body');
    assert.strictEqual(await T.verify('A2', ts, Buffer.from(body), sign('A1', ts, body)), false, 'another id');
    assert.strictEqual(await T.verify('A1', ts, Buffer.from(body), ''), false, 'no signature');
    const old = new Date(Date.now() - 20 * 60000).toISOString();
    assert.strictEqual(await T.verify('A1', old, Buffer.from(body), sign('A1', old, body)), false, 'a stale delivery');
});

ok('chat is off until switched on; the gate opens the webhook only then', async () => {
    fresh();
    assert.strictEqual(chat.gateExempt('POST', chat.WEBHOOK_PATH, {}), false);
    await assert.rejects(() => chat.watch('asmongold', 'k1', () => {}), /switched off/);
    await chat.setEnabled(true);
    assert.strictEqual(chat.gateExempt('POST', chat.WEBHOOK_PATH, {}), true);
    assert.strictEqual(chat.gateExempt('GET', chat.WEBHOOK_PATH, {}), false);
    assert.strictEqual(chat.status().webhookUrl, 'https://example.test/api/videos/kick/webhook');
});

ok('the first panel subscribes at Kick with the app token; the last one closing unsubscribes', async () => {
    fresh();
    await chat.setEnabled(true);
    await assert.rejects(() => chat.watch('nobody', 'k1', () => {}), /not on the list/);
    const a = await chat.watch('asmongold', 'k1', () => {});
    assert.deepStrictEqual(a.messages, []);
    assert.strictEqual(a.canSend, false);
    await chat.watch('asmongold', 'k2', () => {});
    const subs = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/events/subscriptions'));
    assert.strictEqual(subs.length, 1);
    assert.strictEqual(subs[0].auth, 'Bearer app-token');
    assert.deepStrictEqual(JSON.parse(subs[0].body), { broadcaster_user_id: 77, events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' });
    chat.leave('asmongold', 'k1');
    await wait(60);
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'a viewer is left');
    chat.leave('', 'k2');
    await wait(80);
    const del = calls.filter((c) => c.method === 'DELETE');
    assert.strictEqual(del.length, 1);
    assert.ok(/id=sub\d+/.test(del[0].url));
    assert.strictEqual(T.rooms.size, 0);
});

ok('viewers get batches: new messages only, at most 30, with the count of what was skipped', async () => {
    fresh();
    await chat.setEnabled(true);
    const got = [];
    await chat.watch('asmongold', 'k1', (b) => got.push(b));
    T.takeEvent('chat.message.sent', msg(1));
    T.takeEvent('chat.message.sent', msg(2));
    T.flush();
    assert.strictEqual(got.length, 1);
    assert.deepStrictEqual(got[0].messages.map((m) => m.name), ['u1', 'u2']);
    assert.deepStrictEqual(Object.keys(got[0].messages[0]).sort(), ['at', 'badges', 'color', 'id', 'n', 'name', 'text'].sort());
    assert.strictEqual(got[0].messages[0].color, '#FF5733');
    assert.deepStrictEqual(got[0].messages[0].badges, ['subscriber']);
    assert.strictEqual(got[0].skipped, 0);
    T.flush();
    assert.strictEqual(got.length, 1, 'nothing new: nothing sent');
    for (let i = 0; i < 250; i++) T.takeEvent('chat.message.sent', msg(100 + i));
    T.flush();
    assert.strictEqual(got[1].messages.length, 30);
    assert.strictEqual(got[1].skipped, 220);
    assert.strictEqual(got[1].messages[29].name, 'u349');
    // a second panel opening gets what is held (40 at most)
    const b = await chat.watch('asmongold', 'k2', () => {});
    assert.strictEqual(b.messages.length, 40);
    chat.leave('', 'k1');
    chat.leave('', 'k2');
});

ok('a message for a channel nobody watches is dropped; a stream change makes the sources look', async () => {
    fresh();
    await chat.setEnabled(true);
    T.takeEvent('chat.message.sent', msg(1));
    assert.strictEqual(T.rooms.size, 0);
    fresh.looked = 0;
    T.takeEvent('livestream.status.updated', { broadcaster: { channel_slug: 'asmongold' }, is_live: true });
    assert.strictEqual(fresh.looked, 1);
});

ok('linking an account: PKCE, the answer accepted once and only for a state given out; then a message is sent as the user', async () => {
    fresh();
    await chat.setEnabled(true);
    await assert.rejects(() => chat.say('asmongold', 'hi'), /Link a Kick account/);
    const l = chat.linkStart();
    const u = new URL(l.url);
    assert.strictEqual(u.origin + u.pathname, 'https://id.kick.com/oauth/authorize');
    assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://example.test/api/videos/kick/oauth');
    assert.strictEqual(u.searchParams.get('scope'), 'chat:write');
    assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    const st = u.searchParams.get('state');
    assert.strictEqual(chat.gateExempt('GET', chat.OAUTH_PATH, { state: st }), true);
    assert.strictEqual(chat.gateExempt('GET', chat.OAUTH_PATH, { state: 'guess' }), false);
    await T.linkFinish(st, 'the-code');
    const tok = calls.find((c) => c.url.endsWith('/oauth/token'));
    const form = new URLSearchParams(tok.body);
    assert.strictEqual(form.get('grant_type'), 'authorization_code');
    assert.strictEqual(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'), u.searchParams.get('code_challenge'));
    assert.strictEqual(chat.gateExempt('GET', chat.OAUTH_PATH, { state: st }), false, 'used once');
    await assert.rejects(() => T.linkFinish(st, 'the-code'), /no longer waiting/);
    assert.strictEqual(chat.status().linked, true);
    assert.strictEqual(fs.statSync(process.env.VIDEOS_KICK_CHAT_FILE).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(chat.status()).includes('user-access'));
    const r = await chat.say('asmongold', '  hello   there ');
    assert.strictEqual(r.sent, true);
    const sent = calls.find((c) => c.url.endsWith('/chat'));
    assert.strictEqual(sent.auth, 'Bearer user-access');
    assert.deepStrictEqual(JSON.parse(sent.body), { broadcaster_user_id: 77, content: 'hello there', type: 'user' });
    await assert.rejects(() => chat.say('asmongold', 'x'.repeat(501)), /500 characters/);
    await assert.rejects(() => chat.say('asmongold', '   '), /nothing to send/);
});

ok('an emote picture is fetched once and kept on disk; a bad id is refused', async () => {
    fresh();
    assert.strictEqual(await T.emote('../etc'), null);
    const a = await T.emote('37226');
    assert.strictEqual(a.type, 'image/webp');
    const n = calls.length;
    const b = await T.emote('37226');
    assert.strictEqual(b.file, a.file);
    assert.strictEqual(calls.length, n);
});

ok('switching chat off removes every subscription', async () => {
    fresh();
    await chat.setEnabled(true);
    await chat.watch('asmongold', 'k1', () => {});
    await chat.setEnabled(false);
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 1);
    assert.strictEqual(T.rooms.size, 0);
});

(async () => {
    for (const [name, fn] of tests) {
        try { await fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { failed++; console.error(`  FAIL ${name}\n${e.stack}`); }
    }
    T.reset();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${pass} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
