'use strict';

// TokenRouter request gate (#418). The TokenRouter account allows 10 requests a
// minute, failed ones included, across everything that holds the key: the Director
// and Rentan (Claude CLI through modules/tokenRouterBridge.js), persona chat, the
// balance badge, and the Security Center key checks. Every keyed request takes a
// ticket here and waits for a free slot in the rolling window.
//
// Lanes: interactive (Director, persona chat) before normal (Rentan) before
// background (balance, key checks); first come first served inside a lane. A 429
// from TokenRouter pauses the gate for the window (or Retry-After) and puts that
// ticket back at the front of its lane, so the caller waits instead of failing.

const LANES = ['interactive', 'normal', 'background'];
const DEFAULT_PER_MINUTE = 8;
const WINDOW_MS = 60000;
const MAX_429_RETRIES = 3;
// A ticket that waited longer than this is logged once when it gets its slot.
const LOG_WAIT_MS = 3000;

function abortError(signal) {
    const reason = signal && signal.reason;
    if (reason instanceof Error) return reason;
    const error = new Error('TokenRouter request cancelled while queued');
    error.name = 'AbortError';
    return error;
}

function retryAfterMs(response) {
    const header = response && response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('retry-after') : null;
    if (!header) return 0;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const at = Date.parse(header);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

function createGate(options) {
    const opts = options || {};
    const windowMs = opts.windowMs || WINDOW_MS;
    const now = opts.now || (() => Date.now());
    let limitSource = typeof opts.limit === 'function' ? opts.limit : () => opts.limit || DEFAULT_PER_MINUTE;
    const queues = { interactive: [], normal: [], background: [] };
    const granted = [];
    let pausedUntil = 0;
    let timer = null;
    let timerAt = 0;

    function limit() {
        const n = Math.floor(Number(limitSource()));
        return Number.isFinite(n) && n >= 1 ? Math.min(n, 1000) : DEFAULT_PER_MINUTE;
    }

    function prune(t) {
        while (granted.length && t - granted[0] >= windowMs) granted.shift();
    }

    function head() {
        for (const lane of LANES) {
            if (queues[lane].length) return queues[lane][0];
        }
        return null;
    }

    function schedule(ms) {
        const at = now() + Math.max(5, ms);
        if (timer && timerAt <= at) return;
        if (timer) clearTimeout(timer);
        timerAt = at;
        timer = setTimeout(() => {
            timer = null;
            pump();
        }, Math.max(5, ms));
    }

    function pump() {
        for (;;) {
            const ticket = head();
            if (!ticket) return;
            const t = now();
            prune(t);
            if (t < pausedUntil) {
                schedule(pausedUntil - t);
                return;
            }
            if (granted.length >= limit()) {
                schedule(granted[0] + windowMs - t + 5);
                return;
            }
            queues[ticket.lane].shift();
            granted.push(t);
            ticket.grant(t);
        }
    }

    // Resolves when this request may go out. front: a 429 retry keeps its place.
    function acquire(lane, signal, label, front) {
        const name = LANES.includes(lane) ? lane : 'interactive';
        if (signal && signal.aborted) return Promise.reject(abortError(signal));
        return new Promise((resolve, reject) => {
            const queuedAt = now();
            const ticket = { lane: name, label: label || '' };
            const onAbort = () => {
                const list = queues[name];
                const at = list.indexOf(ticket);
                if (at >= 0) list.splice(at, 1);
                reject(abortError(signal));
                pump();
            };
            ticket.grant = (t) => {
                if (signal) signal.removeEventListener('abort', onAbort);
                const waited = t - queuedAt;
                if (waited >= LOG_WAIT_MS) {
                    console.log(`TokenRouter gate: ${ticket.label || name} waited ${(waited / 1000).toFixed(1)}s (${granted.length}/${limit()} in the last minute, ${queuedCount()} still queued)`);
                }
                resolve(waited);
            };
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            if (front) queues[name].unshift(ticket);
            else queues[name].push(ticket);
            pump();
        });
    }

    function queuedCount() {
        return LANES.reduce((n, lane) => n + queues[lane].length, 0);
    }

    function pause(ms) {
        pausedUntil = Math.max(pausedUntil, now() + Math.max(1000, ms));
        pump();
    }

    // fn() makes one request and returns its fetch Response. A 429 is waited out
    // and tried again (the body is drained so the socket is freed).
    async function run(fn, options) {
        const o = options || {};
        for (let attempt = 0; ; attempt++) {
            await acquire(o.lane, o.signal, o.label, attempt > 0);
            const response = await fn();
            if (!response || response.status !== 429 || attempt >= MAX_429_RETRIES) return response;
            try { await response.text(); } catch (_) { /* body already gone */ }
            const wait = retryAfterMs(response) || windowMs;
            console.warn(`TokenRouter gate: 429 on ${o.label || o.lane || 'request'}, holding new requests ${Math.round(wait / 1000)}s`);
            pause(wait);
        }
    }

    function status() {
        const t = now();
        prune(t);
        return {
            limit: limit(),
            windowMs,
            inWindow: granted.length,
            queued: { interactive: queues.interactive.length, normal: queues.normal.length, background: queues.background.length },
            pausedForMs: Math.max(0, pausedUntil - t)
        };
    }

    function configure(next) {
        if (next && typeof next.limit === 'function') limitSource = next.limit;
        else if (next && next.limit != null) limitSource = () => next.limit;
        pump();
    }

    return { run, acquire, pause, status, configure };
}

// One gate for the process: the limit is per TokenRouter account, not per caller.
const gate = createGate();

module.exports = {
    LANES,
    DEFAULT_PER_MINUTE,
    run: gate.run,
    status: gate.status,
    configure: gate.configure,
    _test: { createGate }
};
