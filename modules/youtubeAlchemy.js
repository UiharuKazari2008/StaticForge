/**
 * What YouTube shows only to a signed-in browser, read in Alchemy (Yozora #840): the Watch Later list
 * and each subscribed channel's notification bell. The Data API gives neither (Watch Later answers
 * empty for every program; subscriptions carry no bell), and YouTube's app interface refuses the
 * program's own OAuth sign-in (403), so Yukimi chose (Nov 15 2026) to read them through the server's
 * Alchemy browser, with the Google sign-in it holds.
 *
 * How: over Alchemy's loopback debugging port (ALCHEMY_CDP_PORT, default 127.0.0.1:9339) a hidden
 * background tab is opened at about:blank#alchemy-quiet (the Alchemy service leaves tabs with that
 * mark alone: they are never shown to a viewer), sent to the YouTube page, read, and closed.
 *
 * The Google session never leaves the browser. Nothing here reads or copies a cookie out of Alchemy:
 * a copy presented from a second client is what made Google sign the session out on Nov 13 2026
 * (modules/textMessaging.js). The page itself asks YouTube for the further parts of a long list, the
 * way its own scripts do. Read-only: no click, no change to the account.
 *
 *   read('watch-later')  -> { signedIn, ids[] }                     video ids in list order
 *   read('bells')        -> { signedIn, channels[{ id, title, thumb, bell }] }   bell: all | some | none | ''
 * signedIn false: Alchemy is not signed in to YouTube. Throws ALCHEMY_OFFLINE when Alchemy is not running.
 */
'use strict';

const http = require('http');

const CDP_HOST = '127.0.0.1';
const CDP_PORT = Math.max(0, Number(process.env.ALCHEMY_CDP_PORT || 9339) || 0);
const QUIET_URL = 'about:blank#alchemy-quiet';
const PAGES = {
    'watch-later': 'https://www.youtube.com/playlist?list=WL',
    bells: 'https://www.youtube.com/feed/channels'
};
const READ_TIMEOUT_MS = 60000;

function offline(message) {
    const e = new Error(message || 'The server\'s browser (Alchemy) is not running');
    e.code = 'ALCHEMY_OFFLINE';
    return e;
}

// Runs inside the YouTube page. Returns null until the page's data is there, then a small result.
// `kind` is 'watch-later' or 'bells'; MAX_PARTS further parts of the list are asked for at most.
const IN_PAGE = `(async (kind) => {
    // a signed-out browser is sent to Google's sign-in page for the pages that need an account
    if (/(^|\\.)accounts\\.google\\.com$/.test(location.hostname)) return { signedIn: false };
    if (!window.ytcfg || typeof window.ytcfg.get !== 'function' || !window.ytInitialData) return null;
    const cfg = window.ytcfg;
    if (!cfg.get('LOGGED_IN')) return { signedIn: false };
    const MAX_PARTS = 30;
    const VIDEO = /^[\\w-]{11}$/;
    const CHANNEL = /^UC[\\w-]{22}$/;
    const ids = [];
    const seen = new Set();
    const channels = [];
    let next = '';
    const text = (t) => (t && (t.simpleText || (Array.isArray(t.runs) ? t.runs.map((r) => r.text).join('') : t.content))) || '';
    const find = (node, key, depth) => {
        if (!node || typeof node !== 'object' || depth > 14) return undefined;
        if (!Array.isArray(node) && node[key] !== undefined) return node[key];
        for (const k of Object.keys(node)) { const r = find(node[k], key, (depth || 0) + 1); if (r !== undefined) return r; }
        return undefined;
    };
    const bellOf = (node) => {
        const toggle = find(node, 'subscriptionNotificationToggleButtonRenderer', 0);
        if (!toggle) return '';
        const cur = (toggle.states || []).find((s) => s.stateId === toggle.currentStateId);
        const icon = String((cur && find(cur, 'iconType', 0)) || '');
        if (icon === 'NOTIFICATIONS_ACTIVE' || toggle.currentStateId === 2) return 'all';
        if (icon === 'NOTIFICATIONS_OFF' || toggle.currentStateId === 0) return 'none';
        return 'some';
    };
    const takeVideo = (id) => { if (typeof id === 'string' && VIDEO.test(id) && !seen.has(id)) { seen.add(id); ids.push(id); } };
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        for (const k of Object.keys(node)) {
            const v = node[k];
            if (!v || typeof v !== 'object') continue;
            if (k === 'continuationItemRenderer') { const t = find(v, 'token', 0); if (typeof t === 'string') next = t; continue; }
            if (kind === 'watch-later') {
                if (k === 'playlistVideoRenderer' || k === 'playlistPanelVideoRenderer') { takeVideo(v.videoId); continue; }
                if (k === 'lockupViewModel' && /VIDEO/.test(String(v.contentType || ''))) { takeVideo(v.contentId); continue; }
            } else if (k === 'channelRenderer' || k === 'gridChannelRenderer') {
                if (CHANNEL.test(String(v.channelId || '')) && !seen.has(v.channelId)) {
                    seen.add(v.channelId);
                    const th = (v.thumbnail && v.thumbnail.thumbnails) || [];
                    const url = String((th[th.length - 1] || {}).url || '');
                    channels.push({ id: v.channelId, title: text(v.title), thumb: url.startsWith('//') ? 'https:' + url : url, bell: bellOf(v) });
                }
                continue;
            }
            walk(v);
        }
    };
    // the playlist's own videos only: the page also lists recommendations beside it
    const root = kind === 'watch-later' ? (find(window.ytInitialData, 'playlistVideoListRenderer', 0) || find(window.ytInitialData, 'twoColumnBrowseResultsRenderer', 0) || window.ytInitialData) : window.ytInitialData;
    walk(root);
    const cookie = (document.cookie.match(/(?:^|; )(?:SAPISID|__Secure-3PAPISID)=([^;]+)/) || [])[1];
    const sign = async () => {
        const ts = Math.floor(Date.now() / 1000);
        const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + cookie + ' ' + location.origin));
        return 'SAPISIDHASH ' + ts + '_' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    let parts = 0;
    let partial = false;
    while (next && parts < MAX_PARTS) {
        if (!cookie) { partial = true; break; }
        const token = next;
        next = '';
        parts++;
        try {
            const ctx = cfg.get('INNERTUBE_CONTEXT');
            const res = await fetch('/youtubei/v1/browse?prettyPrint=false', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Authorization: await sign(), 'X-Origin': location.origin, 'X-Goog-AuthUser': String(cfg.get('SESSION_INDEX') || '0'), 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': String((ctx && ctx.client && ctx.client.clientVersion) || '') },
                body: JSON.stringify({ context: ctx, continuation: token })
            });
            if (!res.ok) { partial = true; break; }
            walk(await res.json());
        } catch (_) { partial = true; break; }
    }
    if (next) partial = true;
    return kind === 'watch-later' ? { signedIn: true, ids, partial } : { signedIn: true, channels, partial };
})`;

function browserSocketUrl() {
    if (!CDP_PORT) return Promise.reject(offline('Alchemy has no debugging port'));
    return new Promise((resolve, reject) => {
        const req = http.get({ host: CDP_HOST, port: CDP_PORT, path: '/json/version', timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try { const url = JSON.parse(body).webSocketDebuggerUrl; if (url) { resolve(url); return; } } catch (_) { /* below */ }
                reject(offline());
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => reject(offline()));
    });
}

let queue = Promise.resolve();

/** One read at a time: a hidden tab, the page, its data, the tab closed again. */
function read(kind) {
    if (!PAGES[kind]) return Promise.reject(new Error('Unknown page'));
    const run = queue.then(() => readNow(kind));
    queue = run.catch(() => {});
    return run;
}

async function readNow(kind) {
    const WebSocket = require('ws');
    const ws = new WebSocket(await browserSocketUrl(), { perMessageDeflate: false });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', () => reject(offline())); });
    let nextId = 1;
    const waiting = new Map();
    ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch (_) { return; }
        const w = m.id != null && waiting.get(m.id);
        if (!w) return;
        waiting.delete(m.id);
        if (m.error) w.fail(new Error(m.error.message || 'browser error')); else w.ok(m.result || {});
    });
    ws.on('close', () => { for (const w of waiting.values()) w.fail(offline()); waiting.clear(); });
    const send = (method, params, sessionId) => new Promise((ok, fail) => {
        const id = nextId++;
        waiting.set(id, { ok, fail });
        ws.send(JSON.stringify(Object.assign({ id, method, params: params || {} }, sessionId ? { sessionId } : {})));
    });
    let targetId = null;
    try {
        let target;
        // hidden: not in any tab strip, gone with this connection; an older browser gets a plain background tab
        try { target = await send('Target.createTarget', { url: QUIET_URL, background: true, hidden: true }); } catch (_) { target = await send('Target.createTarget', { url: QUIET_URL, background: true }); }
        targetId = target.targetId;
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        await send('Page.navigate', { url: PAGES[kind] }, sessionId);
        const started = Date.now();
        while (Date.now() - started < READ_TIMEOUT_MS) {
            await new Promise((r) => setTimeout(r, 600));
            const r = await send('Runtime.evaluate', { expression: `${IN_PAGE}(${JSON.stringify(kind)})`, returnByValue: true, awaitPromise: true }, sessionId).catch(() => null);
            const value = r && r.result && r.result.value;
            if (value && typeof value === 'object') return value;
        }
        throw Object.assign(new Error('YouTube did not finish loading in the server\'s browser'), { code: 'ALCHEMY_TIMEOUT' });
    } finally {
        if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {});
        try { ws.close(); } catch (_) { /* gone */ }
    }
}

module.exports = { read, QUIET_URL };
