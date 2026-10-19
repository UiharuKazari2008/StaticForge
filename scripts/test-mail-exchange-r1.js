'use strict';
// PR #346 review r1: key callers never inherit the human-admin fallback;
// bare owner names are not public addresses; signature mXSS is closed.
const assert = require('assert');
const auth = require('../modules/mailExchangeAuth');
const addresses = require('../modules/mailGatewayAddresses');
const exchange = require('../modules/mailExchange');

for (const name of ['Menma', 'Mailroom', 'Exchange', 'Admin', 'Yukimi', 'Sala2', 'Tsubame Mailroom', 'Kazari']) {
    for (const userType of ['admin', 'readonly']) {
        const req = { applicationAuth: { appName: name }, userType };
        for (const actor of [auth.resolveWsActor(req), auth.resolveHttpActor(req), auth.resolveMcpActor(req)]) {
            assert.ok(!exchange.isExchangeAdmin(actor), `${name}/${userType} must not be admin (got ${actor})`);
        }
    }
}
for (const name of ['Sala', 'Tsubame']) {
    assert.ok(exchange.isExchangeAdmin(auth.resolveHttpActor({ applicationAuth: { appName: name }, userType: 'admin' })));
}
assert.strictEqual(auth.resolveHttpActor({ userType: 'admin' }), 'yukimi');
assert.strictEqual(auth.resolveHttpActor({ userType: 'readonly' }), null);

const m = addresses.createMapping({
    mailboxes: { 'kazari.ops': 'yukimi', 'menma.dev': 'menma', postmaster: 'tsubame' },
    aliases: { team: 'menma' },
    domain: 'dream.737.jp.net'
});
assert.deepStrictEqual(addresses.expandRecipients('menma@dream.737.jp.net', m), []);
assert.deepStrictEqual(addresses.expandRecipients('team@dream.737.jp.net', m), ['menma']);
assert.deepStrictEqual(addresses.expandRecipients('postmaster@dream.737.jp.net', m), ['tsubame']);

const sig = exchange.sanitizeSignature('<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>').html;
assert.ok(!/onerror|<img/i.test(sig), sig);
try { require('../modules/mailExchangeDatabase').close(); } catch (_err) { /* ignore */ }
console.log('mail exchange r1 tests passed');
process.exit(0);
