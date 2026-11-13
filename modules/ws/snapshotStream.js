'use strict';

/**
 * A shared, pushed snapshot feed (Yukimi, Nov 13: no client polling flooding the socket).
 *
 * One sampler per feed, however many windows watch it: it reads the snapshot at the fastest rate any
 * subscriber asked for and sends each subscriber `pushType` at its own rate (a Task Manager on "Low"
 * gets every 4 s even while another one runs on "High"). Subscribers go on unsubscribe, socket close
 * or a failed send; the sampler stops with the last one.
 *
 *   const feed = createSnapshotStream({ name, pushType, sample: async (wants) => data, sendToClient });
 *   feed.subscribe(ws, { intervalMs, wants })  -> the latest snapshot (sampled now if none is fresh)
 *   feed.unsubscribe(ws)
 *
 * `wants` is merged over every subscriber (any true wins) and handed to sample(), e.g. Task Manager's
 * services list, which only the Services tab needs.
 */
function createSnapshotStream({ name, pushType, sample, sendToClient, minIntervalMs = 250, maxIntervalMs = 60000 }) {
    const subs = new Map(); // ws -> { intervalMs, wants, lastSent }
    let timer = null;
    let running = false;
    let last = null;        // { data, at }

    const clampMs = (ms) => Math.max(minIntervalMs, Math.min(maxIntervalMs, Number(ms) || 1000));

    function mergedWants() {
        const out = {};
        for (const s of subs.values()) for (const [k, v] of Object.entries(s.wants || {})) if (v) out[k] = true;
        return out;
    }

    function fastest() {
        let ms = maxIntervalMs;
        for (const s of subs.values()) ms = Math.min(ms, s.intervalMs);
        return ms;
    }

    function send(ws, data) {
        if (!ws || ws.readyState !== 1) { unsubscribe(ws); return false; }
        try {
            sendToClient(ws, { type: pushType, data, timestamp: new Date().toISOString() });
            return true;
        } catch (_) {
            unsubscribe(ws);
            return false;
        }
    }

    async function take() {
        const data = await sample(mergedWants());
        last = { data, at: Date.now() };
        return data;
    }

    async function tick() {
        timer = null;
        if (!subs.size || running) return;
        running = true;
        try {
            const data = await take();
            const now = Date.now();
            for (const [ws, s] of subs) {
                // a little slack so a 1000 ms subscriber is not skipped by a 990 ms sample gap
                if (now - s.lastSent >= s.intervalMs - 120) { s.lastSent = now; send(ws, data); }
            }
        } catch (error) {
            console.warn(`[${name}] sample failed: ${error.message}`);
        } finally {
            running = false;
            if (subs.size) timer = setTimeout(tick, fastest());
        }
    }

    async function subscribe(ws, { intervalMs, wants } = {}) {
        if (!subs.has(ws) && ws && typeof ws.once === 'function') ws.once('close', () => unsubscribe(ws));
        const prev = subs.get(ws);
        subs.set(ws, { intervalMs: clampMs(intervalMs), wants: wants || {}, lastSent: Date.now() });
        // a rate change reschedules the sampler; a new subscriber gets a snapshot at once
        if (timer) { clearTimeout(timer); timer = null; }
        let data = last && Date.now() - last.at < 500 && !(wants && Object.keys(wants).some((k) => wants[k] && !(prev && prev.wants && prev.wants[k]))) ? last.data : null;
        if (!data) data = await take();
        if (!running && subs.size && !timer) timer = setTimeout(tick, fastest());
        return data;
    }

    function unsubscribe(ws) {
        subs.delete(ws);
        if (!subs.size) {
            clearTimeout(timer);
            timer = null;
            last = null;
        }
    }

    return { subscribe, unsubscribe, get size() { return subs.size; } };
}

module.exports = { createSnapshotStream };
