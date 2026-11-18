'use strict';

/**
 * The server's global timer manager for status (rule .cursor/rules/server-push-not-polling.mdc,
 * Yukimi Nov 15 2026): clients never poll for status on intervals. Each status source is one feed
 * with one timer, however many clients watch it; the timer runs only while someone is subscribed,
 * reads the upstream once per tick, and pushes only what changed, only to the subscribers.
 *
 *   const feed = statusHub.define({
 *       name: 'xlink',                 // the feed's id (clients subscribe by it)
 *       pushType: 'xlink_status',      // the pushed packet's type
 *       intervalMs: 60000,             // how often the upstream is read while subscribed
 *       allow: (clientInfo) => bool,   // who may subscribe
 *       sample: async () => ({ key: value, ... })   // the whole state, keyed by item
 *   });
 *   feed.subscribe(ws, clientInfo)  -> { items } (the current state, sampled now unless a snapshot younger
 *                                    than intervalMs is kept: one stays an interval after the last subscriber left)
 *   feed.unsubscribe(ws)
 *   feed.poke()                     // something changed upstream: read now (an action, an event)
 *
 * Pushed packet: { type: pushType, feed, changed: { key: value }, removed: [key], timestamp } -
 * sent only when an item's value differs from the last one sent; nothing at all while nothing
 * changes. A subscriber leaves on unsubscribe, socket close or a failed send.
 *
 * The generic packets `status_subscribe { feed }` / `status_unsubscribe { feed }` are registered in
 * modules/ws/handlers/294-statusHubHandler.js.
 */

const feeds = new Map();
let sendToClient = null;

function setSender(fn) { sendToClient = typeof fn === 'function' ? fn : null; }

function define({ name, pushType, intervalMs = 60000, allow = () => true, sample }) {
    if (!name || typeof sample !== 'function') throw new Error('statusHub.define needs name and sample');
    if (feeds.has(name)) return feeds.get(name);
    const subs = new Set();
    let timer = null;
    let running = false;
    let again = false;
    let last = null; // { items: { key: json }, at }
    let dropTimer = null; // lets the kept snapshot go one interval after the last subscriber left
    const closeHooked = new WeakSet();

    const encode = (items) => {
        const out = {};
        for (const [k, v] of Object.entries(items || {})) out[k] = JSON.stringify(v);
        return out;
    };

    function send(ws, packet) {
        if (!ws || ws.readyState !== 1 || !sendToClient) { unsubscribe(ws); return; }
        try { sendToClient(ws, packet); } catch (_) { unsubscribe(ws); }
    }

    async function read() {
        const items = (await sample()) || {};
        const enc = encode(items);
        const changed = {};
        const removed = [];
        const prev = last ? last.items : {};
        for (const [k, j] of Object.entries(enc)) if (prev[k] !== j) changed[k] = items[k];
        for (const k of Object.keys(prev)) if (!(k in enc)) removed.push(k);
        last = { items: enc, raw: items, at: Date.now() };
        return { changed, removed };
    }

    async function tick() {
        timer = null;
        if (!subs.size) return;
        if (running) { again = true; return; }
        running = true;
        try {
            const had = !!last;
            const { changed, removed } = await read();
            if (had && (Object.keys(changed).length || removed.length)) {
                const packet = { type: pushType, feed: name, changed, removed, timestamp: new Date().toISOString() };
                for (const ws of [...subs]) send(ws, packet);
            }
        } catch (error) {
            console.warn(`[statusHub:${name}] read failed: ${error.message}`);
        } finally {
            running = false;
            if (subs.size) timer = setTimeout(tick, again ? 0 : intervalMs);
            again = false;
        }
    }

    async function subscribe(ws, clientInfo) {
        if (!allow(clientInfo)) {
            const err = new Error('Not allowed'); err.code = 'INSUFFICIENT_PERMISSIONS'; throw err;
        }
        // one close listener per socket for the feed's lifetime (a phone subscribes again on every
        // screen-on: a listener per subscribe piled up on its socket, MaxListenersExceededWarning)
        if (ws && typeof ws.once === 'function' && !closeHooked.has(ws)) { closeHooked.add(ws); ws.once('close', () => unsubscribe(ws)); }
        subs.add(ws);
        clearTimeout(dropTimer);
        dropTimer = null;
        // a snapshot younger than one interval is as fresh as a subscriber that stayed would hold (#890
        // round 5): a phone that left Today and came back within it is answered without reading upstream
        if (last && Date.now() - last.at >= intervalMs) last = null;
        if (!last) {
            try { await read(); } catch (error) { console.warn(`[statusHub:${name}] first read failed: ${error.message}`); }
        }
        // the next read when the kept snapshot is one interval old (the cadence a staying subscriber sees)
        if (!timer && !running) timer = setTimeout(tick, last ? Math.max(0, last.at + intervalMs - Date.now()) : intervalMs);
        return { items: last ? last.raw : {} };
    }

    function unsubscribe(ws) {
        subs.delete(ws);
        if (!subs.size) {
            clearTimeout(timer);
            timer = null;
            // kept for one interval for a quick return (subscribe), then let go
            clearTimeout(dropTimer);
            dropTimer = last ? setTimeout(() => { dropTimer = null; if (!subs.size) last = null; }, intervalMs) : null;
            if (dropTimer && dropTimer.unref) dropTimer.unref();
        }
    }

    /** Read now (an action changed something, an upstream event arrived); pushes what changed. */
    function poke() {
        // nobody watching: the kept snapshot is out of date, the next subscriber reads afresh
        if (!subs.size) { last = null; return; }
        clearTimeout(timer);
        timer = null;
        void tick();
    }

    const feed = { name, pushType, subscribe, unsubscribe, poke, get size() { return subs.size; } };
    feeds.set(name, feed);
    return feed;
}

const get = (name) => feeds.get(name) || null;

module.exports = { define, get, setSender };
