/**
 * Sidebar live feed (Yozora #653): one `sidebar_live` push per subscribed tab, at most once a
 * second, instead of every gadget polling on its own request (CPU Meter every 2 s per instance,
 * hosted gadgets' system info every 1 s, weather / quotes / currency / feeds on their own timers).
 *
 * A tab sends `sidebar_live_subscribe` with the union of what its gadgets show
 * (modules/ws/handlers/290-sidebarHandler.js); an empty topic set unsubscribes. Each tick sends
 * host load and system info when subscribed, plus any slow topic whose refresh came due (fetched
 * off the tick, delivered on the next one). A tick with nothing to send sends nothing.
 *
 * Packet: { type: 'sidebar_live', data: { at, host?, system?, weather?, fx?: { 'EUR:USD': rate },
 *           quotes?: { 'AAPL,MSFT': { quotes } }, feeds?: { <url>: feed } } }
 */

const sidebarGadgets = require('./sidebarGadgets');
const sidebarSystemInfo = require('./sidebarSystemInfo');

const TICK_MS = 1000;
const REFRESH_MS = {
    weather: 15 * 60 * 1000,
    quotes: 3 * 60 * 1000,
    fx: 6 * 60 * 60 * 1000,
    feed: 10 * 60 * 1000
};
const MAX_KEYED = 8;
const MAX_BUFFERED_BYTES = 512 * 1024;

/** @type {Map<object, object>} ws -> subscription */
const subscriptions = new Map();
let timer = null;
let globalResourcesRef = null;

function fxPairKey(from, to) {
    const a = String(from || '').trim().toUpperCase();
    const b = String(to || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(a) && /^[A-Z]{3}$/.test(b) ? `${a}:${b}` : '';
}

function quotesKey(symbols) {
    const list = [];
    for (const raw of Array.isArray(symbols) ? symbols : []) {
        const sym = String(raw || '').trim().toUpperCase();
        if (/^[A-Z0-9.^]{1,12}$/.test(sym) && !list.includes(sym)) list.push(sym);
        if (list.length >= 4) break;
    }
    return list.join(',');
}

/** Normalised topic set: { host, system, weather, fx: Set, quotes: Set, feeds: Set } */
function normalizeTopics(raw) {
    const t = raw && typeof raw === 'object' ? raw : {};
    const keyed = (list, keyFn) => {
        const out = new Set();
        for (const item of Array.isArray(list) ? list : []) {
            const key = keyFn(item);
            if (key) out.add(key);
            if (out.size >= MAX_KEYED) break;
        }
        return out;
    };
    return {
        host: t.host === true,
        system: t.system === true,
        weather: t.weather === true,
        fx: keyed(t.fx, (p) => fxPairKey(p && p.from, p && p.to)),
        quotes: keyed(t.quotes, (s) => quotesKey(s)),
        feeds: keyed(t.feeds, (u) => (typeof u === 'string' && u.length <= 300 ? u.trim() : ''))
    };
}

function isEmptyTopics(t) {
    return !t.host && !t.system && !t.weather && !t.fx.size && !t.quotes.size && !t.feeds.size;
}

/** Slow keys of a topic set: 'weather', 'fx:EUR:USD', 'quotes:AAPL', 'feed:<url>'. */
function slowKeys(t) {
    const keys = [];
    if (t.weather) keys.push('weather');
    t.fx.forEach((k) => keys.push(`fx:${k}`));
    t.quotes.forEach((k) => keys.push(`quotes:${k}`));
    t.feeds.forEach((k) => keys.push(`feed:${k}`));
    return keys;
}

function refreshMsFor(key) {
    if (key === 'weather') return REFRESH_MS.weather;
    if (key.startsWith('fx:')) return REFRESH_MS.fx;
    if (key.startsWith('quotes:')) return REFRESH_MS.quotes;
    return REFRESH_MS.feed;
}

function fetchSlow(sub, key) {
    if (key === 'weather') return sidebarGadgets.getClientWeather(globalResourcesRef, sub.clientIP);
    if (key.startsWith('fx:')) {
        const [, from, to] = key.split(':');
        return sidebarGadgets.getFxRate(from, to);
    }
    if (key.startsWith('quotes:')) return sidebarGadgets.getQuotes(key.slice(7).split(','));
    return sidebarGadgets.getFeed(key.slice(5));
}

function startSlowFetch(sub, key) {
    sub.inflight.add(key);
    Promise.resolve()
        .then(() => fetchSlow(sub, key))
        .catch((err) => ({ available: false, error: (err && err.message) || 'unavailable' }))
        .then((data) => {
            sub.inflight.delete(key);
            if (subscriptions.get(sub.ws) !== sub || !slowKeys(sub.topics).includes(key)) return;
            sub.ready.set(key, data || { available: false });
            sub.sentAt.set(key, Date.now());
        });
}

function placeSlow(payload, key, data) {
    if (key === 'weather') {
        payload.weather = data;
    } else if (key.startsWith('fx:')) {
        (payload.fx || (payload.fx = {}))[key.slice(3)] = data;
    } else if (key.startsWith('quotes:')) {
        (payload.quotes || (payload.quotes = {}))[key.slice(7)] = data;
    } else {
        (payload.feeds || (payload.feeds = {}))[key.slice(5)] = data;
    }
}

async function tick() {
    const now = Date.now();
    let host = null;
    let system = null;
    let wantsSystem = false;
    subscriptions.forEach((sub) => { if (sub.topics.system) wantsSystem = true; });
    if (wantsSystem) {
        try { system = await sidebarSystemInfo.getSystemInfo(); } catch (_err) { system = null; }
    }
    for (const sub of [...subscriptions.values()]) {
        const ws = sub.ws;
        if (!ws || ws.readyState !== 1) {
            subscriptions.delete(ws);
            continue;
        }
        const payload = {};
        if (sub.topics.host) {
            if (!host) {
                try { host = sidebarGadgets.getHostLoad(); } catch (_err) { host = null; }
            }
            if (host) payload.host = host;
        }
        if (sub.topics.system && system) payload.system = system;
        for (const key of slowKeys(sub.topics)) {
            if (sub.ready.has(key)) {
                placeSlow(payload, key, sub.ready.get(key));
                sub.ready.delete(key);
            } else if (!sub.inflight.has(key) && now - (sub.sentAt.get(key) || 0) >= refreshMsFor(key)) {
                startSlowFetch(sub, key);
            }
        }
        if (!Object.keys(payload).length) continue;
        // a backed-up socket skips this tick; the next one carries fresh figures anyway
        if (typeof ws.bufferedAmount === 'number' && ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
        payload.at = now;
        try {
            ws.send(JSON.stringify({ type: 'sidebar_live', data: payload, timestamp: new Date(now).toISOString() }));
        } catch (_err) {
            subscriptions.delete(ws);
        }
    }
    if (!subscriptions.size) stopTimer();
}

function startTimer() {
    if (timer) return;
    let running = false;
    timer = setInterval(() => {
        if (running) return;
        running = true;
        tick().catch(() => {}).finally(() => { running = false; });
    }, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
}

function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}

/**
 * Replace the tab's subscription. Slow topics it already had keep their refresh times, so a
 * settings change only fetches the new key.
 * @returns {{ subscribed: boolean, topics: object }}
 */
function subscribe(globalResources, ws, clientIP, rawTopics) {
    if (globalResources) globalResourcesRef = globalResources;
    const topics = normalizeTopics(rawTopics);
    if (isEmptyTopics(topics)) {
        subscriptions.delete(ws);
        if (!subscriptions.size) stopTimer();
        return { subscribed: false, topics: describeTopics(topics) };
    }
    const prev = subscriptions.get(ws);
    const sub = prev || { ws, sentAt: new Map(), ready: new Map(), inflight: new Set() };
    sub.clientIP = clientIP || null;
    sub.topics = topics;
    const keep = new Set(slowKeys(topics));
    for (const key of [...sub.sentAt.keys()]) if (!keep.has(key)) sub.sentAt.delete(key);
    for (const key of [...sub.ready.keys()]) if (!keep.has(key)) sub.ready.delete(key);
    // a resubscribe (reconnect, tab shown again) gets the slow topics it has not seen this socket
    subscriptions.set(ws, sub);
    startTimer();
    return { subscribed: true, topics: describeTopics(topics) };
}

function describeTopics(t) {
    return {
        host: t.host,
        system: t.system,
        weather: t.weather,
        fx: [...t.fx],
        quotes: [...t.quotes],
        feeds: [...t.feeds]
    };
}

function unsubscribe(ws) {
    subscriptions.delete(ws);
    if (!subscriptions.size) stopTimer();
}

module.exports = {
    TICK_MS,
    REFRESH_MS,
    subscribe,
    unsubscribe,
    fxPairKey,
    quotesKey,
    _test: { tick, subscriptions, normalizeTopics, stopTimer }
};
