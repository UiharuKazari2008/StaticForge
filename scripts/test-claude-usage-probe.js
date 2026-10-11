'use strict';
// Claude usage ping: 6-hour refresh, only with a client in the last 4 hours,
// never two calls at once, backoff after a failed attempt.
const assert = require('assert');
const probe = require('../modules/claudeUsageProbe');
const director = require('../modules/cursorDirector')._test;

const H = 60 * 60 * 1000;
let usageAt = 0;
director.claudeUsageAt = () => usageAt;
const clients = new Map();
const gr = { getWebSocketServer: () => ({ clients }) };
let calls = 0;
let release;
const slowPing = () => { calls += 1; return new Promise((r) => { release = r; }); };

(async () => {
    const t0 = 10 * 24 * H;
    probe._test.reset();

    // No client ever: skipped.
    assert.deepStrictEqual(await probe.maybeRefresh(gr, 't', { now: t0, ping: slowPing }), { skipped: 'no client in 4 hours' });

    // A connected client and stale data: one ping; overlapping triggers share it.
    clients.set('ws', { authenticated: true });
    const a = probe.maybeRefresh(gr, 'timer', { now: t0, ping: slowPing });
    const b = probe.maybeRefresh(gr, 'login', { now: t0, ping: slowPing });
    assert.strictEqual(a, b, 'second trigger joins the in-flight ping');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(calls, 1);
    usageAt = t0;
    release({ ok: true });
    assert.deepStrictEqual(await a, { ok: true });
    assert.strictEqual(probe._test.state().inflight, false);

    // Fresh for 6 hours.
    assert.deepStrictEqual(await probe.maybeRefresh(gr, 't', { now: t0 + 5 * H, ping: slowPing }), { skipped: 'fresh' });

    // Client last seen at +5h; at +10h that is over 4 hours: skipped until a client is back.
    clients.clear();
    assert.deepStrictEqual(await probe.maybeRefresh(gr, 't', { now: t0 + 10 * H, ping: slowPing }), { skipped: 'no client in 4 hours' });
    assert.strictEqual(calls, 1);

    // Client back, data stale: refresh; a failure backs off 30 minutes.
    clients.set('ws', { authenticated: true });
    const failed = await probe.maybeRefresh(gr, 'login', { now: t0 + 11 * H, ping: async () => { calls += 1; return { ok: false, error: 'x' }; } });
    assert.strictEqual(failed.ok, false);
    assert.deepStrictEqual(await probe.maybeRefresh(gr, 't', { now: t0 + 11 * H + 10 * 60 * 1000, ping: slowPing }), { skipped: 'backoff' });
    assert.strictEqual(calls, 2);

    // Unauthenticated sockets do not count as a client.
    probe._test.reset();
    clients.clear();
    clients.set('ws', { authenticated: false });
    assert.deepStrictEqual(await probe.maybeRefresh(gr, 't', { now: t0 + 20 * H, ping: slowPing }), { skipped: 'no client in 4 hours' });
    console.log('claude usage probe: ok');
})().catch((err) => { console.error(err); process.exit(1); });
