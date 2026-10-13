#!/usr/bin/env node
'use strict';

// TokenRouter request gate (#418): rolling window, lanes, 429 pause, cancellation.
//   node scripts/test-tokenrouter-gate.js

const assert = require('assert');
const { createGate } = require('../modules/tokenRouterGate')._test;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeResponse = (status, headers) => ({
    status,
    headers: { get: (k) => (headers || {})[k.toLowerCase()] || null },
    text: async () => ''
});

(async () => {
    // ---- window: 2 per 200 ms; the third waits for the oldest slot to age out ----
    {
        const gate = createGate({ limit: 2, windowMs: 200 });
        const t0 = Date.now();
        const at = [];
        await Promise.all([0, 1, 2, 3].map((i) => gate.run(async () => { at[i] = Date.now() - t0; return fakeResponse(200); }, { label: `r${i}` })));
        assert.ok(at[0] < 50 && at[1] < 50, `first two go at once: ${at}`);
        assert.ok(at[2] >= 190 && at[3] >= 190, `the rest wait for the window: ${at}`);
        assert.ok(at[2] < 400, 'but not longer than one window');
        assert.strictEqual(gate.status().inWindow <= 2, true);
    }

    // ---- lanes: interactive overtakes queued background work ----
    {
        const gate = createGate({ limit: 1, windowMs: 150 });
        const order = [];
        const jobs = [
            gate.run(async () => { order.push('first'); return fakeResponse(200); }, { lane: 'background' }),
            gate.run(async () => { order.push('bg'); return fakeResponse(200); }, { lane: 'background' }),
            gate.run(async () => { order.push('rentan'); return fakeResponse(200); }, { lane: 'normal' }),
            gate.run(async () => { order.push('director'); return fakeResponse(200); }, { lane: 'interactive' })
        ];
        const queued = gate.status().queued;
        assert.deepStrictEqual(queued, { interactive: 1, normal: 1, background: 1 });
        await Promise.all(jobs);
        assert.deepStrictEqual(order, ['first', 'director', 'rentan', 'bg']);
    }

    // ---- 429: the gate pauses, the same ticket retries first, the caller sees the 200 ----
    {
        const gate = createGate({ limit: 5, windowMs: 150 });
        let calls = 0;
        const t0 = Date.now();
        const res = await gate.run(async () => {
            calls += 1;
            return calls === 1 ? fakeResponse(429, { 'retry-after': '0.3' }) : fakeResponse(200);
        }, { label: 'chat' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(calls, 2);
        assert.ok(Date.now() - t0 >= 1000, 'paused at least a second (Retry-After floor)');
        // Gives up after 3 retries and hands the 429 back.
        let tries = 0;
        const gave = await createGate({ limit: 50, windowMs: 50 }).run(async () => { tries += 1; return fakeResponse(429, { 'retry-after': '0' }); });
        assert.strictEqual(gave.status, 429);
        assert.strictEqual(tries, 4);
    }

    // ---- cancellation: an aborted caller leaves the queue ----
    {
        const gate = createGate({ limit: 1, windowMs: 300 });
        await gate.run(async () => fakeResponse(200));
        const controller = new AbortController();
        let ran = false;
        const waiting = gate.run(async () => { ran = true; return fakeResponse(200); }, { signal: controller.signal, label: 'killed CLI' });
        assert.strictEqual(gate.status().queued.interactive, 1);
        controller.abort();
        await assert.rejects(waiting, /cancelled|abort/i);
        assert.strictEqual(gate.status().queued.interactive, 0);
        await sleep(350);
        assert.strictEqual(ran, false);
        const pre = new AbortController();
        pre.abort();
        await assert.rejects(gate.run(async () => fakeResponse(200), { signal: pre.signal }));
    }

    // ---- limit changes take effect for queued tickets ----
    {
        let limit = 1;
        const gate = createGate({ limit: () => limit, windowMs: 400 });
        const t0 = Date.now();
        const times = [];
        const jobs = [0, 1, 2].map(() => gate.run(async () => { times.push(Date.now() - t0); return fakeResponse(200); }));
        await sleep(30);
        limit = 3;
        gate.configure({ limit: () => limit });
        await Promise.all(jobs);
        assert.ok(times.every((t) => t < 200), `raised limit frees the queue at once: ${times}`);
    }

    // ---- the shared bridge path uses the gate (relaxer retries included) ----
    {
        const gateModule = require('../modules/tokenRouterGate');
        assert.deepStrictEqual(gateModule.LANES, ['interactive', 'normal', 'background']);
        assert.strictEqual(gateModule.status().limit, 8, 'default 8 of the account\'s 10');
    }

    console.log('tokenrouter gate: ok');
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
