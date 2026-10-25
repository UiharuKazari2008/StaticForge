#!/usr/bin/env node
/**
 * Yozora #653: modules/sidebarLiveFeed.js sends one sidebar_live packet per tab per tick, slow
 * topics only when due, and nothing for closed / unsubscribed sockets.
 * Run: node scripts/test-sidebar-live-feed.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const calls = { host: 0, system: 0, fx: [], quotes: [], feed: [], weather: [] };
function stub(rel, exportsObj) {
    const file = require.resolve(path.join(__dirname, '..', 'modules', rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}
stub('sidebarGadgets', {
    getHostLoad: () => { calls.host += 1; return { cpu: 12, ram: 34 }; },
    getFxRate: async (from, to) => { calls.fx.push(`${from}:${to}`); return { available: true, from, to, rate: 1.5 }; },
    getQuotes: async (symbols) => { calls.quotes.push(symbols.join(',')); return { quotes: symbols.map((symbol) => ({ symbol, available: true, price: 1 })) }; },
    getFeed: async (url) => { calls.feed.push(url); throw new Error('feed down'); },
    getClientWeather: async (_gr, ip) => { calls.weather.push(ip); return { available: true, temp: 20 }; }
});
stub('sidebarSystemInfo', { getSystemInfo: async () => { calls.system += 1; return { cpu: { total: 5, cores: [5] }, at: Date.now() }; } });

const feed = require('../modules/sidebarLiveFeed');
const { tick, subscriptions, stopTimer } = feed._test;

function fakeWs() {
    return { readyState: 1, bufferedAmount: 0, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
}
const flush = () => new Promise((r) => setImmediate(r));

(async () => {
    const a = fakeWs();
    const b = fakeWs();
    feed.subscribe(null, a, '10.0.0.1', { host: true, fx: [{ from: 'eur', to: 'usd' }, { from: 'bad', to: 'x' }], feeds: ['https://example.com/rss'] });
    feed.subscribe(null, b, '10.0.0.2', { system: true, quotes: [['aapl', 'msft']] });
    stopTimer(); // drive ticks by hand

    await tick();
    assert.strictEqual(a.sent.length, 1, 'first tick sends host at once');
    assert.deepStrictEqual(a.sent[0].data.host, { cpu: 12, ram: 34 });
    assert.strictEqual(a.sent[0].type, 'sidebar_live');
    assert.strictEqual(a.sent[0].data.fx, undefined, 'slow topics are fetched off the tick');
    assert.deepStrictEqual(calls.fx, ['EUR:USD'], 'invalid pair dropped, valid pair upper-cased');
    assert.strictEqual(b.sent.length, 1);
    assert.ok(b.sent[0].data.system, 'system on its own subscriber');
    assert.strictEqual(b.sent[0].data.host, undefined, 'b did not ask for host');

    await flush();
    await tick();
    assert.strictEqual(a.sent[1].data.fx['EUR:USD'].rate, 1.5, 'fx delivered on the next tick');
    assert.strictEqual(a.sent[1].data.feeds['https://example.com/rss'].available, false, 'fetch error becomes available:false');
    assert.ok(b.sent[1].data.quotes['AAPL,MSFT'].quotes.length === 2);

    await tick();
    assert.strictEqual(a.sent[2].data.fx, undefined, 'fx not resent before its refresh period');
    assert.deepStrictEqual(calls.fx, ['EUR:USD'], 'no refetch inside the period');
    assert.strictEqual(calls.system, 3, 'system sampled once per tick for all subscribers');

    // settings change keeps the pair it still has, fetches only the new one
    feed.subscribe(null, a, '10.0.0.1', { host: true, fx: [{ from: 'EUR', to: 'USD' }, { from: 'GBP', to: 'JPY' }] });
    stopTimer();
    await tick();
    assert.deepStrictEqual(calls.fx, ['EUR:USD', 'GBP:JPY']);

    // backed-up socket skips the tick, closed socket is dropped
    a.bufferedAmount = 10 * 1024 * 1024;
    const before = a.sent.length;
    await tick();
    assert.strictEqual(a.sent.length, before, 'backed-up socket skipped');
    a.bufferedAmount = 0;
    b.readyState = 3;
    await tick();
    assert.ok(!subscriptions.has(b), 'closed socket removed');

    // empty topics unsubscribe
    const r = feed.subscribe(null, a, '10.0.0.1', {});
    assert.strictEqual(r.subscribed, false);
    assert.strictEqual(subscriptions.size, 0);
    stopTimer();

    // weather goes by the subscriber's client IP
    const c = fakeWs();
    feed.subscribe(null, c, '192.0.2.7', { weather: true });
    stopTimer();
    await tick();
    await flush();
    await tick();
    assert.deepStrictEqual(calls.weather, ['192.0.2.7']);
    assert.strictEqual(c.sent.length, 1, 'nothing to send on the first tick, weather on the second');
    assert.strictEqual(c.sent[0].data.weather.temp, 20);
    feed.unsubscribe(c);

    console.log('test-sidebar-live-feed: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
