/**
 * What YouTube shows only to a signed-in browser, read in Alchemy (Yozora #840): the Watch Later list,
 * each subscribed channel's notification bell and the watch history (which videos were watched, how far). The Data API gives neither (Watch Later answers
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
 * way its own scripts do. No clicks. It changes the account only on the owner's own command: edit() adds
 * a video to, or removes it from, Watch Later (the page's Save request); watched() reports a video as
 * played to its end, or removes its history entry (the entry's own Remove from watch history).
 *
 *   read('watch-later')  -> { signedIn, ids[] }                     video ids in list order
 *   read('bells')        -> { signedIn, channels[{ id, title, thumb, bell }] }   bell: all | some | none | ''
 *   read('memberships')  -> { signedIn, names[] }                      channels with a paid membership (by name)
 *   read('history')      -> { signedIn, items[{ id, pct }] }           the watch history, newest first; pct played
 *   edit('add' | 'remove', videoId) -> { signedIn, ok }
 *   watched(on, videoId) -> { signedIn, ok, found? }                   Mark as Watched / Unwatched on the account
 * signedIn false: Alchemy is not signed in to YouTube. Throws ALCHEMY_OFFLINE when Alchemy is not running.
 */
'use strict';

const http = require('http');

const CDP_HOST = '127.0.0.1';
const CDP_PORT = Math.max(0, Number(process.env.ALCHEMY_CDP_PORT || 9339) || 0);
const QUIET_URL = 'about:blank#alchemy-quiet';
const PAGES = {
    'watch-later': 'https://www.youtube.com/playlist?list=WL',
    bells: 'https://www.youtube.com/feed/channels',
    history: 'https://www.youtube.com/feed/history',
    memberships: 'https://www.youtube.com/paid_memberships',
    'later-add': 'https://www.youtube.com/playlist?list=WL',
    'later-remove': 'https://www.youtube.com/playlist?list=WL',
    'watch-mark': 'https://www.youtube.com/feed/history',
    'watch-unmark': 'https://www.youtube.com/feed/history'
};
const READ_TIMEOUT_MS = 60000;

function offline(message) {
    const e = new Error(message || 'The server\'s browser (Alchemy) is not running');
    e.code = 'ALCHEMY_OFFLINE';
    return e;
}

// Runs inside the YouTube page. Returns null until the page's data is there, then a small result.
// kind: watch-later | bells | history (reads), later-add | later-remove | watch-mark | watch-unmark (the
// owner's own commands, arg = video id).
const IN_PAGE = `(async (kind, arg) => {
    // a signed-out browser is sent to Google's sign-in page for the pages that need an account
    if (/(^|\\.)accounts\\.google\\.com$/.test(location.hostname)) return { signedIn: false };
    if (!window.ytcfg || typeof window.ytcfg.get !== 'function' || !window.ytInitialData) return null;
    const cfg = window.ytcfg;
    if (!cfg.get('LOGGED_IN')) return { signedIn: false };
    const VIDEO = /^[\\w-]{11}$/;
    const CHANNEL = /^UC[\\w-]{22}$/;
    // how many further parts of a long list are asked for, and when enough is enough
    const MAX_PARTS = { 'watch-later': 4, bells: 30, history: 3, 'watch-unmark': 8 }[kind] || 0;
    const ids = [];
    const seen = new Set();
    const channels = [];
    const items = [];
    let removeToken = '';
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
    // a history entry's menu row "Remove from watch history": the row that carries a feedback token (the
    // menu sits deep inside the entry), by its wording when the entry has more than one such row
    const removeTokenOf = (entry) => {
        const rows = [];
        const deep = (node, depth) => {
            if (!node || typeof node !== 'object' || depth > 40) return;
            if (Array.isArray(node)) { node.forEach((n) => deep(n, depth + 1)); return; }
            for (const k of Object.keys(node)) {
                if (k === 'listItemViewModel' || k === 'menuServiceItemRenderer') {
                    const token = find(node[k], 'feedbackToken', 0);
                    if (typeof token === 'string' && token) rows.push({ token, label: text(node[k].title) || text(node[k].text) });
                    continue;
                }
                deep(node[k], depth + 1);
            }
        };
        deep(entry, 0);
        const named = rows.filter((r) => /remove/i.test(r.label) && /history/i.test(r.label));
        return named.length ? named[0].token : rows.length === 1 ? rows[0].token : '';
    };
    const takeVideo = (id) => { if (typeof id === 'string' && VIDEO.test(id) && !seen.has(id)) { seen.add(id); ids.push(id); } };
    // a watched video in the history list: how much of it was played, and its "remove from history" token
    const takeWatched = (id, node) => {
        if (typeof id !== 'string' || !VIDEO.test(id)) return;
        if (kind === 'watch-unmark' && id === arg && !removeToken) removeToken = removeTokenOf(node);
        if (seen.has(id)) return;
        seen.add(id);
        let pct = find(node, 'startPercent', 0);
        if (pct === undefined) pct = find(node, 'percentDurationWatched', 0);
        items.push({ id, pct: typeof pct === 'number' ? Math.max(0, Math.min(100, Math.round(pct))) : null });
    };
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
            } else if (kind === 'history' || kind === 'watch-unmark') {
                if (k === 'lockupViewModel' && /VIDEO/.test(String(v.contentType || ''))) { takeWatched(v.contentId, v); continue; }
                if (k === 'videoRenderer') { takeWatched(v.videoId, v); continue; }
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
    const cookie = (document.cookie.match(/(?:^|; )(?:SAPISID|__Secure-3PAPISID)=([^;]+)/) || [])[1];
    const sign = async () => {
        const ts = Math.floor(Date.now() / 1000);
        const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + cookie + ' ' + location.origin));
        return 'SAPISIDHASH ' + ts + '_' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    // the page's own way to ask YouTube: the request its scripts make, with the session the browser holds
    const post = async (path, body) => {
        const ctx = cfg.get('INNERTUBE_CONTEXT');
        const res = await fetch('/youtubei/v1/' + path + '?prettyPrint=false', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Authorization: await sign(), 'X-Origin': location.origin, 'X-Goog-AuthUser': String(cfg.get('SESSION_INDEX') || '0'), 'X-Youtube-Client-Name': '1', 'X-Youtube-Client-Version': String((ctx && ctx.client && ctx.client.clientVersion) || '') },
            body: JSON.stringify(Object.assign({ context: ctx }, body))
        });
        return { ok: res.ok, body: await res.json().catch(() => ({})) };
    };

    // ---- the owner's own commands
    if (kind === 'later-add' || kind === 'later-remove' || kind === 'watch-mark') {
        if (!cookie || !VIDEO.test(String(arg))) return { signedIn: true, ok: false };
        try {
            if (kind !== 'watch-mark') {
                // Add to / Remove from Watch Later: the request the page's Save button makes
                const r = await post('browse/edit_playlist', { playlistId: 'WL', actions: [kind === 'later-add' ? { action: 'ACTION_ADD_VIDEO', addedVideoId: arg } : { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: arg }] });
                return { signedIn: true, ok: r.ok && r.body.status === 'STATUS_SUCCEEDED' };
            }
            // Mark as Watched: what the player reports when a video was played to its end (the two
            // addresses YouTube hands the player for it), so the video is in the account's history as watched
            const p = await post('player', { videoId: arg });
            const track = (p.body && p.body.playbackTracking) || {};
            const started = track.videostatsPlaybackUrl && track.videostatsPlaybackUrl.baseUrl;
            const played = track.videostatsWatchtimeUrl && track.videostatsWatchtimeUrl.baseUrl;
            if (!p.ok || !started || !played) return { signedIn: true, ok: false };
            const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
            const cpn = Array.from({ length: 16 }, () => abc[Math.floor(Math.random() * 64)]).join('');
            const a = new URL(started);
            a.searchParams.set('ver', '2');
            a.searchParams.set('cpn', cpn);
            const b = new URL(played);
            const len = String(Math.max(1, (parseFloat(b.searchParams.get('len')) || 1.5) - 1));
            b.searchParams.set('ver', '2');
            b.searchParams.set('cpn', cpn);
            b.searchParams.set('cmt', len);
            b.searchParams.set('el', 'detailpage');
            b.searchParams.set('st', '0');
            b.searchParams.set('et', len);
            await fetch(a.toString(), { mode: 'no-cors', credentials: 'include' });
            await fetch(b.toString(), { mode: 'no-cors', credentials: 'include' });
            return { signedIn: true, ok: true };
        } catch (_) { return { signedIn: true, ok: false }; }
    }

    // ---- the channels the account pays a membership on: the cards under Memberships, before the inactive ones
    if (kind === 'memberships') {
        const names = [];
        let section = '';
        const cards = (node, depth) => {
            if (!node || typeof node !== 'object' || depth > 40) return;
            if (Array.isArray(node)) { node.forEach((n) => cards(n, depth + 1)); return; }
            for (const k of Object.keys(node)) {
                if (k !== 'cardItemRenderer') { cards(node[k], depth + 1); continue; }
                const texts = [];
                const grab = (n, d) => {
                    if (!n || typeof n !== 'object' || d > 20) return;
                    if (Array.isArray(n)) { n.forEach((x) => grab(x, d + 1)); return; }
                    for (const key of Object.keys(n)) { if ((key === 'simpleText' || key === 'text') && typeof n[key] === 'string') texts.push(n[key].trim()); else grab(n[key], d + 1); }
                };
                grab(node[k], 0);
                const all = texts.join(' ');
                if (texts.length === 1) { section = /inactive/i.test(all) ? 'inactive' : /membership/i.test(all) ? 'active' : 'other'; continue; }
                if (section === 'active' && texts[0] && !/expired/i.test(all)) names.push(texts[0]);
            }
        };
        cards(window.ytInitialData, 0);
        return { signedIn: true, names };
    }

    // ---- lists
    // the playlist's own videos only: the page also lists recommendations beside it
    const root = kind === 'watch-later' ? (find(window.ytInitialData, 'playlistVideoListRenderer', 0) || find(window.ytInitialData, 'twoColumnBrowseResultsRenderer', 0) || window.ytInitialData) : window.ytInitialData;
    walk(root);
    const enough = () => (kind === 'watch-later' && ids.length >= 300) || (kind === 'watch-unmark' && !!removeToken);
    let parts = 0;
    let partial = false;
    while (next && parts < MAX_PARTS && !enough()) {
        if (!cookie) { partial = true; break; }
        const token = next;
        next = '';
        parts++;
        try {
            const r = await post('browse', { continuation: token });
            if (!r.ok) { partial = true; break; }
            walk(r.body);
        } catch (_) { partial = true; break; }
    }
    if (next) partial = true;
    if (kind === 'watch-unmark') {
        // Mark as Unwatched: the history entry's own "Remove from watch history"
        if (!removeToken) return { signedIn: true, ok: false, found: false };
        try {
            const r = await post('feedback', { feedbackTokens: [removeToken], isFeedbackTokenUnencrypted: false, shouldMerge: false });
            return { signedIn: true, found: true, ok: r.ok && !!(r.body.feedbackResponses || []).some((f) => f.isProcessed) };
        } catch (_) { return { signedIn: true, found: true, ok: false }; }
    }
    if (kind === 'history') return { signedIn: true, items, partial };
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
function read(kind, arg) {
    if (!PAGES[kind]) return Promise.reject(new Error('Unknown page'));
    const run = queue.then(() => readNow(kind, arg));
    queue = run.catch(() => {});
    return run;
}

async function readNow(kind, arg) {
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
            const r = await send('Runtime.evaluate', { expression: `${IN_PAGE}(${JSON.stringify(kind)}, ${JSON.stringify(arg === undefined ? null : arg)})`, returnByValue: true, awaitPromise: true }, sessionId).catch(() => null);
            const value = r && r.result && r.result.value;
            if (value && typeof value === 'object') return value;
        }
        throw Object.assign(new Error('YouTube did not finish loading in the server\'s browser'), { code: 'ALCHEMY_TIMEOUT' });
    } finally {
        if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {});
        try { ws.close(); } catch (_) { /* gone */ }
    }
}

/** Add a video to, or remove it from, the account's Watch Later list: { signedIn, ok }. */
const edit = (action, videoId) => read(action === 'remove' ? 'later-remove' : 'later-add', String(videoId));
/** Put a video in the account's watch history as watched, or take its history entry out: { signedIn, ok, found? }. */
const watched = (on, videoId) => read(on ? 'watch-mark' : 'watch-unmark', String(videoId));

module.exports = { read, edit, watched, QUIET_URL };
