/**
 * QuickCast's YouTube side (Yozora #734): sign-in, the broadcast (title, description, privacy...) and
 * live chat, over the YouTube Data API v3 with Yukimi's own Google Cloud project.
 *
 *   apiKey                 reads only (the chat of a public live video). Optional.
 *   oauth clientId/secret  an OAuth client of type "TVs and Limited Input devices": QuickCast signs in
 *                          with Google's device flow (a code on google.com/device), so no redirect URL is
 *                          needed. Scope youtube. With it QuickCast creates the broadcast with the
 *                          title, binds it to the stream key's stream, and can post chat replies.
 *
 * Everything lives in the QuickCast config (config.json, 0600) under youtube: apiKey, oauth
 * { clientId, clientSecret }, token { refreshToken, accessToken, expiresAt }, channel { id, title },
 * last { title, description, privacy, categoryId, latency, dvr, madeForKids }, broadcast { id, videoId,
 * liveChatId, title, createdAt }. Secrets and tokens never go to the client.
 *
 * Quota (10,000 units a day by default): a go-live costs ~150 (insert 50 + bind 50 + videos.update 50),
 * a chat read 5, a reply 50. Chat is read only while a Live Chat window polls, at YouTube's own
 * pollingIntervalMillis but never faster than CHAT_MIN_MS.
 */
'use strict';

const GOOGLE = process.env.QUICKCAST_GOOGLE_BASE || 'https://oauth2.googleapis.com';
const YT = process.env.QUICKCAST_YT_BASE || 'https://www.googleapis.com/youtube/v3';
const SCOPE = 'https://www.googleapis.com/auth/youtube';
const CHAT_MIN_MS = Number(process.env.QUICKCAST_CHAT_MIN_MS || 5000);
const CHAT_LEASE_MS = 20000;
const DEVICE_MIN_S = Number(process.env.QUICKCAST_DEVICE_MIN_S || 5);
const CHAT_KEEP = 300;

const PRIVACY = ['public', 'unlisted', 'private'];
const LATENCY = ['normal', 'low', 'ultraLow'];

let store = null; // { read(): raw config, write(raw) } from modules/quickcast.js

function init(s) { store = s; }

function fail(message, code) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function yt() {
    const raw = store.read();
    raw.youtube = raw.youtube || {};
    return { raw, y: raw.youtube };
}

function save(mutate) {
    const { raw, y } = yt();
    mutate(y);
    store.write(raw);
}

// ------------------------------------------------------------------ HTTP

async function form(url, fields) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

async function accessToken() {
    const { y } = yt();
    const t = y.token || {};
    if (!t.refreshToken) throw fail('QuickCast is not signed in to YouTube (Broadcast Settings > Account)', 'QUICKCAST_YT_SIGNIN');
    if (t.accessToken && t.expiresAt && Date.now() < t.expiresAt - 60000) return t.accessToken;
    const o = y.oauth || {};
    const r = await form(`${GOOGLE}/token`, { grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: o.clientId || '', client_secret: o.clientSecret || '' });
    if (r.status !== 200 || !r.body.access_token) {
        if (r.body.error === 'invalid_grant') save((yy) => { yy.token = {}; });
        throw fail(`YouTube sign-in expired, sign in again (${r.body.error_description || r.body.error || r.status})`, 'QUICKCAST_YT_SIGNIN');
    }
    save((yy) => {
        yy.token = { ...yy.token, accessToken: r.body.access_token, expiresAt: Date.now() + (Number(r.body.expires_in) || 3600) * 1000 };
        const cur = yy.channel && yy.accounts && yy.accounts[yy.channel.id];
        if (cur) cur.token = yy.token;
    });
    return r.body.access_token;
}

/** A YouTube Data API call. auth: 'user' (OAuth), 'read' (OAuth, else the API key). */
async function api(method, path, { query = {}, body, auth = 'user' } = {}) {
    const { y } = yt();
    const q = new URLSearchParams(query);
    const headers = {};
    if (auth === 'read' && !(y.token && y.token.refreshToken)) {
        if (!y.apiKey) throw fail('No YouTube API key or sign-in (Broadcast Settings > Account)', 'QUICKCAST_YT_SIGNIN');
        q.set('key', y.apiKey);
    } else headers.Authorization = `Bearer ${await accessToken()}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${YT}/${path}?${q}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
    if (!res.ok) {
        const e = data.error || {};
        const reason = (e.errors && e.errors[0] && e.errors[0].reason) || '';
        const err = fail(`YouTube: ${e.message || res.status}${reason ? ` (${reason})` : ''}`, reason === 'quotaExceeded' ? 'QUICKCAST_YT_QUOTA' : 'QUICKCAST_YT_API');
        err.reason = reason;
        throw err;
    }
    return data;
}

// ------------------------------------------------------------------ sign-in (device flow)

let pendingSignIn = null; // { deviceCode, userCode, url, interval, expiresAt, state, error }

async function signInStart() {
    const { y } = yt();
    const o = y.oauth || {};
    if (!o.clientId || !o.clientSecret) throw fail('Enter the OAuth client ID and secret first', 'QUICKCAST_YT_CLIENT');
    const r = await form(`${GOOGLE}/device/code`, { client_id: o.clientId, scope: SCOPE });
    if (r.status !== 200 || !r.body.device_code) throw fail(`Google refused the sign-in: ${r.body.error_description || r.body.error || r.status}. The OAuth client must be of type "TVs and Limited Input devices".`, 'QUICKCAST_YT_CLIENT');
    const p = {
        deviceCode: r.body.device_code,
        userCode: r.body.user_code,
        url: r.body.verification_url || r.body.verification_uri || 'https://www.google.com/device',
        interval: Math.max(DEVICE_MIN_S, Number(r.body.interval) || 5) * 1000,
        expiresAt: Date.now() + (Number(r.body.expires_in) || 1800) * 1000,
        state: 'waiting',
        error: ''
    };
    pendingSignIn = p;
    void pollSignIn(p, o);
    return { userCode: p.userCode, url: p.url, expiresAt: p.expiresAt };
}

// a device-code sign-in ended (done, failed, expired): 300-quickcastHandler.js tells the window
// that started it (quickcast_yt_signin_push), so it does not poll quickcast_yt_signin_state
const signInListeners = new Set();
function onSignIn(fn) { signInListeners.add(fn); return () => signInListeners.delete(fn); }

async function pollSignIn(p, o) {
    await pollSignInLoop(p, o);
    if (pendingSignIn !== p || p.state === 'waiting') return;
    for (const fn of signInListeners) { try { fn(); } catch (_) { /* the listener's own problem */ } }
}

async function pollSignInLoop(p, o) {
    while (pendingSignIn === p && p.state === 'waiting') {
        await new Promise((r) => setTimeout(r, p.interval));
        if (pendingSignIn !== p) return;
        if (Date.now() > p.expiresAt) { p.state = 'failed'; p.error = 'The code expired'; return; }
        let r;
        try { r = await form(`${GOOGLE}/token`, { client_id: o.clientId, client_secret: o.clientSecret, device_code: p.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }); } catch (_) { continue; }
        if (r.status === 200 && r.body.refresh_token) {
            save((y) => { y.token = { refreshToken: r.body.refresh_token, accessToken: r.body.access_token, expiresAt: Date.now() + (Number(r.body.expires_in) || 3600) * 1000 }; });
            try {
                const prof = await fetchProfile();
                save((y) => {
                    y.channel = prof;
                    y.accounts = y.accounts || {};
                    if (prof.id) y.accounts[prof.id] = { channel: prof, token: y.token };
                    y.broadcast = {};
                });
                chat.reset('');
            } catch (e) { p.error = e.message; }
            p.state = 'done';
            return;
        }
        const err = r.body.error;
        if (err === 'authorization_pending') continue;
        if (err === 'slow_down') { p.interval += 5000; continue; }
        p.state = 'failed';
        p.error = err === 'access_denied' ? 'The sign-in was declined' : (r.body.error_description || err || `HTTP ${r.status}`);
        return;
    }
}

function signInState() {
    const p = pendingSignIn;
    return p ? { state: p.state, userCode: p.userCode, url: p.url, error: p.error, expiresAt: p.expiresAt } : { state: 'none' };
}

/** The signed-in channel's public profile: name, handle, avatar, subscribers, videos. */
async function fetchProfile() {
    const ch = await api('GET', 'channels', { query: { part: 'snippet,statistics', mine: 'true' } });
    const c = ch.items && ch.items[0];
    if (!c) return { id: '', title: '' };
    const th = (c.snippet.thumbnails && (c.snippet.thumbnails.medium || c.snippet.thumbnails.default)) || {};
    const st = c.statistics || {};
    return {
        id: c.id,
        title: c.snippet.title,
        handle: c.snippet.customUrl || '',
        avatar: th.url || '',
        subscribers: st.hiddenSubscriberCount ? null : Number(st.subscriberCount) || 0,
        videos: Number(st.videoCount) || 0,
        views: Number(st.viewCount) || 0,
        at: Date.now()
    };
}

/** The active channel's profile, refreshed when older than 10 minutes (1 quota unit). */
async function refreshProfile(force) {
    const { y } = yt();
    if (!(y.token && y.token.refreshToken)) return account();
    const cur = y.channel || {};
    if (!force && cur.at && Date.now() - cur.at < 600000 && cur.avatar !== undefined) return account();
    const prof = await fetchProfile();
    save((yy) => {
        yy.channel = prof;
        yy.accounts = yy.accounts || {};
        if (prof.id) yy.accounts[prof.id] = { channel: prof, token: yy.token };
    });
    return account();
}

/** Make a saved channel the active one (its own sign-in). Not while QuickCast's broadcast is live. */
function selectAccount(channelId) {
    const { y } = yt();
    const a = y.accounts && y.accounts[channelId];
    if (!a) throw fail('That channel is not signed in', 'QUICKCAST_YT_SIGNIN');
    save((yy) => { yy.token = a.token; yy.channel = a.channel; yy.broadcast = {}; });
    chat.reset('');
    return { ok: true, account: account() };
}

/** Sign out the active channel (another saved one becomes active), or every channel with all. */
function signOut(all) {
    pendingSignIn = null;
    save((y) => {
        const id = y.channel && y.channel.id;
        if (all) y.accounts = {}; else if (y.accounts && id) delete y.accounts[id];
        const next = Object.values(y.accounts || {})[0];
        y.token = next ? next.token : {};
        y.channel = next ? next.channel : {};
        y.broadcast = {};
    });
    chat.reset('');
    return { ok: true, account: account() };
}

/** API key / OAuth client: blank keeps, '-' clears. */
function setCredentials({ apiKey, clientId, clientSecret, channelId }) {
    const clean = (v) => (v === undefined || v === null ? undefined : String(v).trim());
    const ak = clean(apiKey); const ci = clean(clientId); const cs = clean(clientSecret); const ch = clean(channelId);
    if (ak && ak !== '-' && !/^[A-Za-z0-9_-]{20,64}$/.test(ak)) throw fail('That does not look like a Google API key', 'QUICKCAST_YT_BAD');
    if (ci && ci !== '-' && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(ci)) throw fail('The OAuth client ID ends in .apps.googleusercontent.com', 'QUICKCAST_YT_BAD');
    if (cs && cs !== '-' && !/^[\w-]{10,80}$/.test(cs)) throw fail('That does not look like an OAuth client secret', 'QUICKCAST_YT_BAD');
    if (ch && ch !== '-' && !/^UC[\w-]{22}$/.test(ch)) throw fail('A channel ID starts with UC and has 24 characters', 'QUICKCAST_YT_BAD');
    save((y) => {
        if (ak) y.apiKey = ak === '-' ? '' : ak;
        y.oauth = y.oauth || {};
        if (ci) { if (ci !== y.oauth.clientId) y.token = {}; y.oauth.clientId = ci === '-' ? '' : ci; }
        if (cs) y.oauth.clientSecret = cs === '-' ? '' : cs;
        if (ch) y.channelId = ch === '-' ? '' : ch;
    });
    return { ok: true, account: account() };
}

function account() {
    const { y } = yt();
    const c = y.channel || {};
    const pub = (ch) => ({ id: ch.id, title: ch.title, handle: ch.handle || '', avatar: ch.avatar || '', subscribers: ch.subscribers == null ? null : ch.subscribers, videos: ch.videos || 0 });
    return {
        profile: c.id ? pub(c) : null,
        channels: Object.values(y.accounts || {}).map((a) => ({ ...pub(a.channel), active: a.channel.id === c.id })),
        apiKey: !!y.apiKey,
        client: !!(y.oauth && y.oauth.clientId && y.oauth.clientSecret),
        clientId: y.oauth && y.oauth.clientId ? `${String(y.oauth.clientId).split('-')[0]}-…` : '',
        signedIn: !!(y.token && y.token.refreshToken),
        channel: (y.channel && y.channel.title) || '',
        channelId: (y.channel && y.channel.id) || y.channelId || ''
    };
}

// ------------------------------------------------------------------ broadcast settings

const DEFAULT_LAST = { title: 'Live from Playland Gau', description: '', privacy: 'public', categoryId: '20', latency: 'low', dvr: true, madeForKids: false };

function lastSettings() {
    const { y } = yt();
    return { ...DEFAULT_LAST, ...(y.last || {}) };
}

function cleanSettings(s) {
    const cur = lastSettings();
    const out = { ...cur };
    if (s.title !== undefined) {
        const t = String(s.title).replace(/[<>]/g, '').trim();
        if (!t) throw fail('The stream title is empty', 'QUICKCAST_YT_BAD');
        if (t.length > 100) throw fail('YouTube titles are at most 100 characters', 'QUICKCAST_YT_BAD');
        out.title = t;
    }
    if (s.description !== undefined) {
        const d = String(s.description).replace(/[<>]/g, '');
        if (d.length > 5000) throw fail('YouTube descriptions are at most 5,000 characters', 'QUICKCAST_YT_BAD');
        out.description = d;
    }
    if (s.privacy !== undefined) { if (!PRIVACY.includes(s.privacy)) throw fail('Unknown privacy', 'QUICKCAST_YT_BAD'); out.privacy = s.privacy; }
    if (s.latency !== undefined) { if (!LATENCY.includes(s.latency)) throw fail('Unknown latency', 'QUICKCAST_YT_BAD'); out.latency = s.latency; }
    if (s.categoryId !== undefined) { if (!/^\d{1,3}$/.test(String(s.categoryId))) throw fail('Unknown category', 'QUICKCAST_YT_BAD'); out.categoryId = String(s.categoryId); }
    if (s.dvr !== undefined) out.dvr = !!s.dvr;
    if (s.madeForKids !== undefined) out.madeForKids = !!s.madeForKids;
    return out;
}

/** Save the broadcast settings (they pre-fill the next stream). While live, the title / description
 *  / category also go to the live video at once. */
async function saveSettings(s) {
    const next = cleanSettings(s || {});
    save((y) => { y.last = next; });
    const { y } = yt();
    let updated = false;
    if (y.broadcast && y.broadcast.videoId && y.token && y.token.refreshToken && s && s.applyLive) {
        await api('PUT', 'videos', { query: { part: 'snippet' }, body: { id: y.broadcast.videoId, snippet: { title: next.title, description: next.description, categoryId: next.categoryId } } });
        save((yy) => { yy.broadcast.title = next.title; });
        updated = true;
    }
    return { ok: true, last: next, updatedLive: updated };
}

/**
 * Before Start Streaming (signed in): a new broadcast with the settings, bound to the stream key's
 * stream, auto start / stop on. Returns null when not signed in (YouTube Studio's own settings apply).
 */
async function prepareBroadcast(streamKey, settings) {
    const acct = account();
    if (!acct.signedIn) return null;
    const s = cleanSettings(settings || {});
    save((y) => { y.last = s; });
    const streams = await api('GET', 'liveStreams', { query: { part: 'id,cdn,snippet', mine: 'true', maxResults: '50' } });
    const stream = (streams.items || []).find((it) => it.cdn && it.cdn.ingestionInfo && it.cdn.ingestionInfo.streamName === streamKey);
    if (!stream) throw fail('The stream key is not one of this YouTube channel\'s streams (signed in to the wrong channel?)', 'QUICKCAST_YT_STREAM');
    const b = await api('POST', 'liveBroadcasts', {
        query: { part: 'snippet,status,contentDetails' },
        body: {
            snippet: { title: s.title, description: s.description, scheduledStartTime: new Date().toISOString() },
            status: { privacyStatus: s.privacy, selfDeclaredMadeForKids: !!s.madeForKids },
            contentDetails: { enableAutoStart: true, enableAutoStop: true, enableDvr: !!s.dvr, latencyPreference: s.latency, monitorStream: { enableMonitorStream: false } }
        }
    });
    await api('POST', 'liveBroadcasts/bind', { query: { part: 'id,snippet', id: b.id, streamId: stream.id } });
    try {
        await api('PUT', 'videos', { query: { part: 'snippet' }, body: { id: b.id, snippet: { title: s.title, description: s.description, categoryId: s.categoryId } } });
    } catch (_) { /* the category is cosmetic */ }
    const bc = { id: b.id, videoId: b.id, streamId: stream.id, liveChatId: (b.snippet && b.snippet.liveChatId) || '', title: s.title, createdAt: Date.now() };
    save((y) => { y.broadcast = bc; });
    chat.reset(bc.liveChatId);
    return bc;
}

/** After STOP: end the broadcast when YouTube has not (auto stop usually has). */
async function endBroadcast() {
    const { y } = yt();
    if (!y.broadcast || !y.broadcast.id || !account().signedIn) return;
    try { await api('POST', 'liveBroadcasts/transition', { query: { part: 'status', id: y.broadcast.id, broadcastStatus: 'complete' } }); } catch (_) { /* already complete */ }
}

function broadcastInfo() {
    const { y } = yt();
    const b = y.broadcast || {};
    return b.id ? { id: b.id, title: b.title, watchUrl: `https://www.youtube.com/watch?v=${b.videoId}`, shortUrl: `https://youtu.be/${b.videoId}`, studioUrl: `https://studio.youtube.com/video/${b.videoId}/livestreaming` } : null;
}

// ------------------------------------------------------------------ ingest health

const health = { streamId: '', status: '', issues: [], at: 0, pending: null, error: '' };

/** YouTube's ingest health of the broadcast's stream (liveStreams status.healthStatus, 1 unit),
 *  refreshed every 30 s while live. null when QuickCast did not make the broadcast. Never waits. */
function streamHealth(active) {
    const { y } = yt();
    const b = y.broadcast || {};
    if (!active || !b.streamId || !account().signedIn) return null;
    if (health.streamId !== b.streamId) Object.assign(health, { streamId: b.streamId, status: '', issues: [], at: 0, error: '' });
    if (!health.pending && Date.now() - health.at > 30000) {
        health.at = Date.now();
        health.pending = api('GET', 'liveStreams', { query: { part: 'status', id: b.streamId } })
            .then((r) => {
                const it = r.items && r.items[0];
                const hs = (it && it.status && it.status.healthStatus) || {};
                health.status = String(hs.status || (it ? 'noData' : ''));
                health.issues = (hs.configurationIssues || []).slice(0, 5).map((c) => ({
                    type: String(c.type || ''), severity: String(c.severity || ''), reason: String(c.reason || ''), description: String(c.description || '').slice(0, 300)
                }));
                health.error = '';
            })
            .catch((e) => { health.error = e.message; })
            .finally(() => { health.pending = null; });
    }
    return { status: health.status, issues: health.issues, at: health.at, error: health.error };
}

// ------------------------------------------------------------------ live viewers

const liveStats = { videoId: '', viewers: null, likes: null, at: 0, pending: null };

/** Concurrent viewers of QuickCast's broadcast, refreshed every 30 s while asked (1 unit). Never waits. */
function viewers(active) {
    const b = broadcastInfo();
    if (!active || !b) return null;
    if (liveStats.videoId !== b.id) Object.assign(liveStats, { videoId: b.id, viewers: null, likes: null, at: 0 });
    if (!liveStats.pending && Date.now() - liveStats.at > 30000) {
        liveStats.at = Date.now();
        liveStats.pending = api('GET', 'videos', { auth: 'read', query: { part: 'liveStreamingDetails,statistics', id: b.id } })
            .then((r) => {
                const it = r.items && r.items[0];
                if (!it) return;
                const cv = it.liveStreamingDetails && it.liveStreamingDetails.concurrentViewers;
                liveStats.viewers = cv == null ? 0 : Number(cv) || 0;
                liveStats.likes = it.statistics && it.statistics.likeCount != null ? Number(it.statistics.likeCount) : null;
            })
            .catch(() => {})
            .finally(() => { liveStats.pending = null; });
    }
    return { viewers: liveStats.viewers, likes: liveStats.likes, at: liveStats.at };
}

// ------------------------------------------------------------------ live chat

const chat = {
    liveChatId: '',
    messages: [],
    seq: 0,
    pageToken: '',
    nextAt: 0,
    leaseAt: 0,
    error: '',
    timer: null,
    running: false,
    reset(id) {
        this.liveChatId = id || '';
        this.messages = [];
        this.pageToken = '';
        this.error = '';
    }
};

/** The chat to read: QuickCast's own broadcast, else (with a channel) the channel's live video. */
async function resolveChatId() {
    if (chat.liveChatId) return chat.liveChatId;
    const { y } = yt();
    if (y.broadcast && y.broadcast.liveChatId) { chat.liveChatId = y.broadcast.liveChatId; return chat.liveChatId; }
    if (account().signedIn) {
        const r = await api('GET', 'liveBroadcasts', { query: { part: 'snippet', broadcastStatus: 'active', broadcastType: 'all' } });
        const it = r.items && r.items[0];
        if (it && it.snippet.liveChatId) { chat.liveChatId = it.snippet.liveChatId; return chat.liveChatId; }
        return '';
    }
    const channelId = y.channelId;
    if (!channelId || !y.apiKey) return '';
    const s = await api('GET', 'search', { auth: 'read', query: { part: 'id', channelId, eventType: 'live', type: 'video', maxResults: '1' } });
    const vid = s.items && s.items[0] && s.items[0].id.videoId;
    if (!vid) return '';
    const v = await api('GET', 'videos', { auth: 'read', query: { part: 'liveStreamingDetails', id: vid } });
    chat.liveChatId = (v.items && v.items[0] && v.items[0].liveStreamingDetails && v.items[0].liveStreamingDetails.activeLiveChatId) || '';
    return chat.liveChatId;
}

function mapMessage(it) {
    const sn = it.snippet || {};
    const a = it.authorDetails || {};
    const sc = sn.superChatDetails || sn.superStickerDetails;
    return {
        id: it.id,
        at: Date.parse(sn.publishedAt) || Date.now(),
        type: sn.type || '',
        text: sn.displayMessage || (sn.textMessageDetails && sn.textMessageDetails.messageText) || '',
        author: a.displayName || '?',
        avatar: a.profileImageUrl || '',
        owner: !!a.isChatOwner,
        mod: !!a.isChatModerator,
        member: !!a.isChatSponsor,
        verified: !!a.isVerified,
        amount: sc ? sc.amountDisplayString || '' : ''
    };
}

// the reader got something (messages, a state change): 300-quickcastHandler.js pushes it to the
// Live Chat windows (quickcast_chat_push), so they do not poll quickcast_chat
const chatListeners = new Set();
function onChat(fn) { chatListeners.add(fn); return () => chatListeners.delete(fn); }
function notifyChat() { for (const fn of chatListeners) { try { fn(); } catch (_) { /* the listener's own problem */ } } }

async function chatTick() {
    chat.timer = null;
    if (Date.now() - chat.leaseAt > CHAT_LEASE_MS) { chat.running = false; return; }
    let wait = CHAT_MIN_MS;
    try {
        const id = await resolveChatId();
        if (!id) { chat.error = 'No live chat yet: go live first'; wait = 15000; } else {
            const q = { part: 'snippet,authorDetails', liveChatId: id, maxResults: '200' };
            if (chat.pageToken) q.pageToken = chat.pageToken;
            const r = await api('GET', 'liveChat/messages', { auth: 'read', query: q });
            const first = !chat.pageToken;
            chat.pageToken = r.nextPageToken || chat.pageToken;
            const seen = new Set(chat.messages.map((m) => m.id));
            for (const it of r.items || []) {
                if (seen.has(it.id)) continue;
                const m = mapMessage(it);
                m.seq = ++chat.seq;
                m.backlog = first;
                chat.messages.push(m);
            }
            if (chat.messages.length > CHAT_KEEP) chat.messages.splice(0, chat.messages.length - CHAT_KEEP);
            chat.error = r.offlineAt ? 'The chat has ended' : '';
            wait = Math.max(CHAT_MIN_MS, Number(r.pollingIntervalMillis) || 0);
        }
    } catch (e) {
        chat.error = e.message;
        if (e.reason === 'liveChatEnded' || e.reason === 'liveChatNotFound' || e.reason === 'forbidden') chat.liveChatId = '';
        wait = e.code === 'QUICKCAST_YT_QUOTA' ? 300000 : 15000;
    }
    chat.nextAt = Date.now() + wait;
    chat.timer = setTimeout(() => void chatTick(), wait);
    if (chat.timer.unref) chat.timer.unref();
    notifyChat();
}

/** Messages after `since` (a seq); keeps the reader running while a Live Chat window polls. */
function chatRead(since) {
    chat.leaseAt = Date.now();
    if (!chat.running) { chat.running = true; void chatTick(); }
    const s = Number(since) || 0;
    const acct = account();
    return {
        messages: chat.messages.filter((m) => m.seq > s).slice(-200),
        seq: chat.seq,
        problem: chat.error, // not `error`: a reply with an error key reads as a failed request
        nextInMs: Math.max(0, chat.nextAt - Date.now()),
        canReply: acct.signedIn,
        canRead: acct.signedIn || (acct.apiKey && !!yt().y.channelId),
        broadcast: broadcastInfo()
    };
}

async function chatSend(text) {
    const t = String(text || '').trim();
    if (!t) throw fail('The message is empty', 'QUICKCAST_YT_BAD');
    if (t.length > 200) throw fail('Chat messages are at most 200 characters', 'QUICKCAST_YT_BAD');
    const id = await resolveChatId();
    if (!id) throw fail('There is no live chat to reply to yet', 'QUICKCAST_YT_NOCHAT');
    const r = await api('POST', 'liveChat/messages', { query: { part: 'snippet,authorDetails' }, body: { snippet: { liveChatId: id, type: 'textMessageEvent', textMessageDetails: { messageText: t } } } });
    if (r && r.id && !chat.messages.some((m) => m.id === r.id)) {
        const m = mapMessage(r);
        if (!r.authorDetails) { m.author = account().channel || 'You'; m.owner = true; }
        m.seq = ++chat.seq;
        chat.messages.push(m);
        notifyChat();
    }
    return { ok: true };
}

module.exports = {
    init, account, setCredentials, signInStart, signInState, signOut, refreshProfile, selectAccount,
    lastSettings, saveSettings, prepareBroadcast, endBroadcast, broadcastInfo, viewers, streamHealth,
    chatRead, chatSend, onChat, onSignIn, PRIVACY, LATENCY, _chat: chat
};
