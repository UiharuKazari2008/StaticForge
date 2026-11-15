/**
 * Melaton Mobile YouTube (Yozora #839): the server side of the phone's YouTube program. Yukimi,
 * Nov 15 2026: sign in, see your subscriptions, Watch Later and Search; a Today item (6.1 and 6.5)
 * that pages through the latest uploads of a chosen list of favourite channels.
 *
 * This module is the only code that talks to YouTube for the program. It uses the YouTube Data API v3
 * with the household's own Google Cloud project:
 *
 *   OAuth client   Service key `youtube` (Client ID field + client secret as the key value), an OAuth
 *                  client of type "TVs and Limited Input devices". When none is saved, the client
 *                  VisionCaster already holds (modules/quickcastYoutube.js) is used, so there is nothing
 *                  to set up on a server that streams.
 *   Sign-in        Google's device flow: the phone shows a code, the user enters it on
 *                  google.com/device, and this module waits on Google's token endpoint (the flow's own
 *                  wait, at Google's interval) until the account is linked. Scope youtube.readonly.
 *                  The token is this program's own (VisionCaster's sign-in is not touched).
 *
 *   subscriptions  subscriptions.list mine=true (1 unit per 50 channels), kept 6 hours
 *   uploads        playlistItems.list of a channel's uploads list (1 unit a channel), kept 20 minutes;
 *                  "UULF" + id = the channel's long videos only (the Leave Out Shorts setting)
 *   details        videos.list (1 unit per 50 videos): length, live state; kept for good
 *   search         search.list (100 units), each answer kept 10 minutes
 *   Watch Later    the Data API does not give this list to any program (it answers empty since 2016).
 *                  watchLater() asks YouTube's own app interface with the same sign-in for the video
 *                  ids and reads their details through the Data API. When YouTube refuses, the answer
 *                  says so ({ unavailable: true }) and the program offers the list in the YouTube app.
 *
 * Quota: the project's 10,000 units a day are shared with VisionCaster. Units are counted per Pacific
 * day in .cache/youtube-usage.json and stop at settings.budget (6,000) with a plain message.
 *
 * Push, never poll (rule server-push-not-polling): statusHub feed `youtube` (push type
 * youtube_status) carries { account, favourites, latest, settings }. The feed's one timer runs only
 * while a phone shows the Today item or the program; it re-reads a favourite channel's uploads when
 * they are older than 15 minutes and pushes only what changed.
 *
 * Files (all under .cache): youtube-account.json (0600: token, account, favourites, settings),
 * youtube-cache.json (subscriptions, uploads, video details), youtube-usage.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GOOGLE = process.env.YOUTUBE_GOOGLE_BASE || 'https://oauth2.googleapis.com';
const API = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';
const APP_API = process.env.YOUTUBE_APP_BASE || 'https://www.youtube.com/youtubei/v1';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const ACCOUNT_FILE = process.env.YOUTUBE_ACCOUNT_FILE || path.join(CACHE_DIR, 'youtube-account.json');
const CACHE_FILE = process.env.YOUTUBE_CACHE_FILE || path.join(CACHE_DIR, 'youtube-cache.json');
const USAGE_FILE = process.env.YOUTUBE_USAGE_FILE || path.join(CACHE_DIR, 'youtube-usage.json');
const QUICKCAST_CONFIG = process.env.YOUTUBE_QUICKCAST_CONFIG || path.join(CACHE_DIR, 'packages', '.data', 'quickcast', 'config.json');

const MIN = 60000;
const SUBS_TTL = 6 * 60 * MIN;
const UPLOADS_TTL = 20 * MIN;
const LATEST_TTL = 15 * MIN;
const SEARCH_TTL = 10 * MIN;
const FEED_MIN_GAP = 5 * MIN; // a Refresh inside this gap answers from what is held
const HUB_INTERVAL = 5 * MIN;
const DEVICE_MIN_S = Number(process.env.YOUTUBE_DEVICE_MIN_S || 5);
const DEFAULTS = { noShorts: true, todayCount: 12, budget: 6000 };
const MAX_FAVOURITES = 40;
const MAX_DETAILS = 3000;

class YouTubeError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code || 'YOUTUBE_ERROR';
    }
}
const fail = (message, code) => new YouTubeError(message, code);

let gr = null;
let hub = null;
let acct = { token: {}, account: null, favourites: [], settings: {} };
let cache = { subs: null, uploads: {}, details: {} };
let pending = null; // the sign-in in progress: { deviceCode, userCode, url, expiresAt, interval, timer }
let refreshing = null; // the favourites read in progress
let lastError = '';
const searches = new Map(); // query|page -> { at, data }
let feedMemo = null; // { at, videos }
let saveTimer = null;

// ------------------------------------------------------------------------------------------ files

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return null; }
}

function writeJson(file, value, mode) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(value), mode ? { mode } : undefined);
        if (mode) { try { fs.chmodSync(tmp, mode); } catch (_e) { /* written */ } }
        fs.renameSync(tmp, file);
    } catch (e) {
        console.warn(`[youtube] ${path.basename(file)} not saved: ${e.message}`);
    }
}

function loadFiles() {
    const a = readJson(ACCOUNT_FILE);
    if (a && typeof a === 'object') {
        acct = {
            token: a.token && typeof a.token === 'object' ? a.token : {},
            account: a.account || null,
            favourites: Array.isArray(a.favourites) ? a.favourites.map(cleanChannel).filter(Boolean) : [],
            settings: a.settings && typeof a.settings === 'object' ? a.settings : {}
        };
    }
    const c = readJson(CACHE_FILE);
    if (c && typeof c === 'object') {
        cache = { subs: c.subs || null, uploads: c.uploads && typeof c.uploads === 'object' ? c.uploads : {}, details: c.details && typeof c.details === 'object' ? c.details : {} };
    }
}

const saveAccount = () => writeJson(ACCOUNT_FILE, acct, 0o600);

function saveCacheSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const ids = Object.keys(cache.details);
        if (ids.length > MAX_DETAILS) ids.slice(0, ids.length - MAX_DETAILS).forEach((id) => { delete cache.details[id]; });
        writeJson(CACHE_FILE, cache);
    }, 2000);
    if (saveTimer.unref) saveTimer.unref();
}

function bind(globalResources) {
    if (globalResources && !gr) {
        gr = globalResources;
        loadFiles();
    }
    return module.exports;
}

// ------------------------------------------------------------------------------------------ settings, favourites

function settings() {
    const s = acct.settings || {};
    const n = Number(s.todayCount);
    const b = Number(s.budget);
    return {
        noShorts: s.noShorts === undefined ? DEFAULTS.noShorts : !!s.noShorts,
        todayCount: Number.isFinite(n) ? Math.max(3, Math.min(30, Math.round(n))) : DEFAULTS.todayCount,
        budget: Number.isFinite(b) ? Math.max(500, Math.min(10000, Math.round(b))) : DEFAULTS.budget
    };
}

const CHANNEL_ID = /^UC[\w-]{22}$/;
const VIDEO_ID = /^[\w-]{11}$/;

function cleanChannel(c) {
    if (!c || !CHANNEL_ID.test(String(c.id || ''))) return null;
    const thumb = /^https:\/\/[\w.-]+\.(ggpht|googleusercontent)\.com\//.test(String(c.thumb || '')) ? String(c.thumb) : '';
    return { id: String(c.id), title: String(c.title || '').slice(0, 120) || 'Channel', thumb };
}

async function saveSettings(next) {
    const cur = settings();
    const before = cur.noShorts;
    acct.settings = Object.assign({}, acct.settings, {
        noShorts: next && next.noShorts !== undefined ? !!next.noShorts : cur.noShorts,
        todayCount: next && next.todayCount !== undefined ? next.todayCount : cur.todayCount
    });
    saveAccount();
    if (settings().noShorts !== before) { cache.uploads = {}; feedMemo = null; saveCacheSoon(); }
    poke();
    return settings();
}

async function setFavourite(channel, on) {
    const c = cleanChannel(channel);
    if (!c) throw fail('That is not a channel', 'YOUTUBE_BAD_CHANNEL');
    const rest = acct.favourites.filter((f) => f.id !== c.id);
    if (on) {
        if (rest.length >= MAX_FAVOURITES) throw fail(`Today holds up to ${MAX_FAVOURITES} favourite channels`, 'YOUTUBE_FAVOURITES_FULL');
        rest.push(c);
    }
    acct.favourites = rest;
    saveAccount();
    poke();
    return acct.favourites.slice();
}

async function orderFavourites(ids) {
    const want = Array.isArray(ids) ? ids.map(String) : [];
    const by = new Map(acct.favourites.map((f) => [f.id, f]));
    const out = [];
    want.forEach((id) => { if (by.has(id)) { out.push(by.get(id)); by.delete(id); } });
    acct.favourites = out.concat([...by.values()]);
    saveAccount();
    poke();
    return acct.favourites.slice();
}

// ------------------------------------------------------------------------------------------ quota

let usage = null;
const pacificDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);

function usageNow() {
    const day = pacificDay();
    if (!usage) usage = readJson(USAGE_FILE) || { day, units: 0 };
    if (usage.day !== day) usage = { day, units: 0 };
    return usage;
}

function spend(units) {
    const u = usageNow();
    if (u.units + units > settings().budget) throw fail('Today\'s YouTube allowance is used up. It starts again at midnight Pacific time.', 'YOUTUBE_BUDGET');
    u.units += units;
    writeJson(USAGE_FILE, u);
}

const quota = () => ({ used: usageNow().units, budget: settings().budget });

// ------------------------------------------------------------------------------------------ Google sign-in

function serviceKey(service) {
    try {
        const manager = gr && gr.getApiKeyManager && gr.getApiKeyManager();
        if (!manager) return null;
        return manager.getServiceKeys(service)[manager.getSelectedIndex(service)] || null;
    } catch (_e) {
        return null;
    }
}

/** The OAuth client: Service key `youtube`, else the one VisionCaster holds. */
function oauthClient() {
    const k = serviceKey('youtube');
    if (k && k.clientId && k.apiKey) return { clientId: String(k.clientId).trim(), clientSecret: String(k.apiKey).trim(), from: 'key' };
    const q = readJson(QUICKCAST_CONFIG);
    const o = q && q.youtube && q.youtube.oauth;
    if (o && o.clientId && o.clientSecret) return { clientId: String(o.clientId), clientSecret: String(o.clientSecret), from: 'visioncaster' };
    return null;
}

async function form(url, fields) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

const signedIn = () => !!(acct.token && acct.token.refreshToken);

function dropSignIn(reason) {
    acct.token = {};
    acct.account = null;
    cache.subs = null;
    feedMemo = null;
    lastError = reason || '';
    saveAccount();
    saveCacheSoon();
}

async function accessToken() {
    const t = acct.token || {};
    if (!t.refreshToken) throw fail('Sign in to YouTube first', 'YOUTUBE_SIGNIN');
    if (t.accessToken && t.expiresAt && Date.now() < t.expiresAt - MIN) return t.accessToken;
    const o = oauthClient();
    if (!o) throw fail('The server has no Google sign-in client for YouTube (Service keys > YouTube)', 'YOUTUBE_NO_CLIENT');
    const r = await form(`${GOOGLE}/token`, { grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: o.clientId, client_secret: o.clientSecret });
    if (r.status !== 200 || !r.body.access_token) {
        if (r.body && r.body.error === 'invalid_grant') {
            dropSignIn('The YouTube sign-in ended. Sign in again.');
            poke();
            throw fail('The YouTube sign-in ended. Sign in again.', 'YOUTUBE_SIGNIN');
        }
        throw fail(`Google did not renew the sign-in (${(r.body && (r.body.error_description || r.body.error)) || r.status})`, 'YOUTUBE_TOKEN');
    }
    acct.token.accessToken = r.body.access_token;
    acct.token.expiresAt = Date.now() + (Number(r.body.expires_in) || 3600) * 1000;
    saveAccount();
    return acct.token.accessToken;
}

function signInView() {
    if (!pending) return null;
    return { userCode: pending.userCode, url: pending.url, expiresAt: pending.expiresAt };
}

async function signInStart() {
    const o = oauthClient();
    if (!o) throw fail('The server has no Google sign-in client for YouTube yet. Add one under Service keys > YouTube.', 'YOUTUBE_NO_CLIENT');
    if (pending && Date.now() < pending.expiresAt - MIN) return signInView();
    signInCancel(true);
    const r = await form(`${GOOGLE}/device/code`, { client_id: o.clientId, scope: SCOPE });
    if (r.status !== 200 || !r.body.device_code) {
        throw fail(`Google did not start the sign-in (${(r.body && (r.body.error_description || r.body.error)) || r.status})`, 'YOUTUBE_SIGNIN_START');
    }
    pending = {
        deviceCode: r.body.device_code,
        userCode: String(r.body.user_code || ''),
        url: String(r.body.verification_url || r.body.verification_uri || 'https://www.google.com/device'),
        expiresAt: Date.now() + (Number(r.body.expires_in) || 1800) * 1000,
        interval: Math.max(DEVICE_MIN_S, Number(r.body.interval) || 5),
        timer: null
    };
    lastError = '';
    waitForSignIn(pending);
    poke();
    return signInView();
}

// The device flow's own wait: Google is asked at its interval until the code is entered or runs out.
function waitForSignIn(p) {
    const again = () => {
        if (pending !== p) return;
        p.timer = setTimeout(step, p.interval * 1000);
        if (p.timer.unref) p.timer.unref();
    };
    const step = async () => {
        if (pending !== p) return;
        if (Date.now() >= p.expiresAt) { pending = null; lastError = 'The code ran out before it was entered. Start the sign-in again.'; poke(); return; }
        const o = oauthClient();
        let r;
        try {
            r = await form(`${GOOGLE}/token`, { client_id: o ? o.clientId : '', client_secret: o ? o.clientSecret : '', device_code: p.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        } catch (_e) { again(); return; }
        if (pending !== p) return;
        const err = r.body && r.body.error;
        if (r.status === 200 && r.body.access_token) {
            pending = null;
            acct.token = { refreshToken: r.body.refresh_token || '', accessToken: r.body.access_token, expiresAt: Date.now() + (Number(r.body.expires_in) || 3600) * 1000 };
            acct.account = null;
            cache.subs = null;
            feedMemo = null;
            saveAccount();
            try { await loadAccount(); } catch (e) { console.warn(`[youtube] account not read: ${e.message}`); }
            poke();
            return;
        }
        if (err === 'authorization_pending') { again(); return; }
        if (err === 'slow_down') { p.interval += 5; again(); return; }
        pending = null;
        lastError = err === 'access_denied' ? 'The sign-in was refused on the Google page.' : err === 'expired_token' ? 'The code ran out before it was entered. Start the sign-in again.' : `Google ended the sign-in (${(r.body && (r.body.error_description || err)) || r.status})`;
        poke();
    };
    again();
}

function signInCancel(quiet) {
    if (!pending) return false;
    clearTimeout(pending.timer);
    pending = null;
    if (!quiet) poke();
    return true;
}

async function signOut() {
    signInCancel(true);
    const token = acct.token && (acct.token.refreshToken || acct.token.accessToken);
    dropSignIn('');
    cache.uploads = {};
    if (token) {
        try { await form(`${GOOGLE}/revoke`, { token }); } catch (_e) { /* the token is forgotten here either way */ }
    }
    poke();
    return getState();
}

// ------------------------------------------------------------------------------------------ Data API

async function api(resource, params, units = 1, retried = false) {
    const token = await accessToken();
    spend(units);
    const qs = new URLSearchParams(params).toString();
    let res;
    try {
        res = await fetch(`${API}/${resource}?${qs}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
        throw fail(`YouTube could not be reached (${e.name === 'TimeoutError' ? 'no answer in time' : e.message})`, 'YOUTUBE_NETWORK');
    }
    if (res.status === 401 && !retried) {
        acct.token.accessToken = '';
        return api(resource, params, 0, true);
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 200) return body;
    const err = (body && body.error) || {};
    const reason = (err.errors && err.errors[0] && err.errors[0].reason) || '';
    if (res.status === 404) throw fail('YouTube does not have that', 'YOUTUBE_NOT_FOUND');
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw fail('YouTube\'s daily allowance for this server is used up. It starts again at midnight Pacific time.', 'YOUTUBE_QUOTA');
    if (reason === 'accessNotConfigured') throw fail('The YouTube Data API is not enabled in the Google Cloud project of the sign-in client.', 'YOUTUBE_API_OFF');
    throw fail(`YouTube answered ${res.status}${err.message ? `: ${String(err.message).replace(/<[^>]+>/g, '').slice(0, 160)}` : ''}`, 'YOUTUBE_API');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', '#39': '\'' };
const plain = (t) => String(t == null ? '' : t).replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
    if (ENTITIES[e]) return ENTITIES[e];
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16) || 32);
    if (/^#\d/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 10) || 32);
    return m;
});

const thumbOf = (th, id) => (th && ((th.medium && th.medium.url) || (th.high && th.high.url) || (th.default && th.default.url))) || (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '');

/** ISO 8601 "PT1H2M3S" in seconds. */
function seconds(iso) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
    if (!m) return null;
    return (Number(m[1]) || 0) * 86400 + (Number(m[2]) || 0) * 3600 + (Number(m[3]) || 0) * 60 + (Number(m[4]) || 0);
}

async function pool(items, size, fn) {
    const out = new Array(items.length);
    let next = 0;
    const run = async () => {
        while (next < items.length) {
            const i = next++;
            try { out[i] = await fn(items[i], i); } catch (e) { out[i] = e; }
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
    return out;
}

async function loadAccount() {
    const d = await api('channels', { part: 'snippet', mine: 'true', maxResults: '1' });
    const c = d.items && d.items[0];
    acct.account = c ? { id: c.id, title: plain(c.snippet && c.snippet.title) || 'YouTube', thumb: thumbOf(c.snippet && c.snippet.thumbnails) } : { id: '', title: 'YouTube', thumb: '' };
    saveAccount();
    return acct.account;
}

async function subscriptions(opts = {}) {
    if (!signedIn()) throw fail('Sign in to YouTube first', 'YOUTUBE_SIGNIN');
    const held = cache.subs;
    if (held && Array.isArray(held.list) && !(opts.fresh && Date.now() - held.at > FEED_MIN_GAP) && Date.now() - held.at < SUBS_TTL) return held.list;
    const list = [];
    let pageToken = '';
    for (let page = 0; page < 40; page++) {
        const p = { part: 'snippet', mine: 'true', maxResults: '50', order: 'alphabetical' };
        if (pageToken) p.pageToken = pageToken;
        const d = await api('subscriptions', p);
        (d.items || []).forEach((it) => {
            const s = it.snippet || {};
            const c = cleanChannel({ id: s.resourceId && s.resourceId.channelId, title: plain(s.title), thumb: thumbOf(s.thumbnails) });
            if (c) list.push(c);
        });
        pageToken = d.nextPageToken || '';
        if (!pageToken) break;
    }
    cache.subs = { at: Date.now(), list };
    // a favourite keeps the channel's current name and picture
    const by = new Map(list.map((c) => [c.id, c]));
    let touched = false;
    acct.favourites = acct.favourites.map((f) => {
        const c = by.get(f.id);
        if (c && (c.title !== f.title || c.thumb !== f.thumb)) { touched = true; return c; }
        return f;
    });
    if (touched) { saveAccount(); poke(); }
    saveCacheSoon();
    return list;
}

/** Fills length and live state (and anything missing) from videos.list; one unit per 50 videos. */
async function withDetails(videos) {
    const need = [...new Set(videos.filter((v) => v && !cache.details[v.id]).map((v) => v.id))];
    for (let i = 0; i < need.length; i += 50) {
        const ids = need.slice(i, i + 50);
        let d;
        try { d = await api('videos', { part: 'snippet,contentDetails', id: ids.join(','), maxResults: '50' }); } catch (e) {
            if (e.code === 'YOUTUBE_BUDGET' || e.code === 'YOUTUBE_QUOTA') break;
            throw e;
        }
        (d.items || []).forEach((it) => {
            const s = it.snippet || {};
            cache.details[it.id] = {
                title: plain(s.title), channel: plain(s.channelTitle), channelId: s.channelId || '', thumb: thumbOf(s.thumbnails, it.id),
                at: Date.parse(s.publishedAt) || null, length: seconds(it.contentDetails && it.contentDetails.duration), live: s.liveBroadcastContent === 'live' ? 'live' : s.liveBroadcastContent === 'upcoming' ? 'upcoming' : ''
            };
        });
        ids.forEach((id) => { if (!cache.details[id]) cache.details[id] = { gone: true }; });
        saveCacheSoon();
    }
    return videos.filter((v) => v && !(cache.details[v.id] && cache.details[v.id].gone)).map((v) => {
        const d = cache.details[v.id];
        if (!d) return v;
        return {
            id: v.id, title: v.title || d.title, channel: v.channel || d.channel, channelId: v.channelId || d.channelId, thumb: v.thumb || d.thumb,
            at: v.at || d.at, length: d.length, live: d.live
        };
    });
}

async function readUploads(channelId, max) {
    const tail = channelId.slice(2);
    const lists = settings().noShorts ? [`UULF${tail}`, `UU${tail}`] : [`UU${tail}`];
    let d = null;
    for (const playlistId of lists) {
        try {
            d = await api('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: String(max) });
            break;
        } catch (e) {
            if (e.code !== 'YOUTUBE_NOT_FOUND') throw e;
        }
    }
    const videos = [];
    ((d && d.items) || []).forEach((it) => {
        const s = it.snippet || {};
        const id = (it.contentDetails && it.contentDetails.videoId) || (s.resourceId && s.resourceId.videoId);
        if (!id || !VIDEO_ID.test(id) || /^(Private|Deleted) video$/.test(s.title || '')) return;
        videos.push({
            id, title: plain(s.title), channel: plain(s.videoOwnerChannelTitle || s.channelTitle), channelId: s.videoOwnerChannelId || s.channelId || channelId,
            thumb: thumbOf(s.thumbnails, id), at: Date.parse((it.contentDetails && it.contentDetails.videoPublishedAt) || s.publishedAt) || null, length: null, live: ''
        });
    });
    videos.sort((a, b) => (b.at || 0) - (a.at || 0));
    return videos;
}

/** A channel's newest uploads, from what is held when that is young enough. */
async function uploadsOf(channelId, opts = {}) {
    const max = opts.max || 8;
    const ttl = opts.ttl || UPLOADS_TTL;
    const held = cache.uploads[channelId];
    if (held && Array.isArray(held.videos) && held.max >= max && Date.now() - held.triedAt < ttl) return held.videos.slice(0, max);
    const entry = cache.uploads[channelId] = Object.assign({ videos: [], max: 0, at: 0 }, held, { triedAt: Date.now() });
    const videos = await readUploads(channelId, max);
    entry.videos = videos;
    entry.max = max;
    entry.at = Date.now();
    saveCacheSoon();
    return videos.slice(0, max);
}

/** The subscriptions feed: every subscribed channel's newest uploads, newest first. */
async function feed(opts = {}) {
    if (feedMemo && !(opts.fresh && Date.now() - feedMemo.at > FEED_MIN_GAP) && Date.now() - feedMemo.at < UPLOADS_TTL) return feedMemo;
    const channels = await subscriptions();
    const left = quota().budget - quota().used;
    let partial = false;
    const got = await pool(channels, 8, async (c, i) => {
        const held = cache.uploads[c.id];
        const fresh = held && Date.now() - held.triedAt < UPLOADS_TTL;
        if (!fresh && i >= left - 20) { partial = true; return (held && held.videos) || []; }
        return uploadsOf(c.id, { max: 5 });
    });
    let failed = 0;
    const all = [];
    got.forEach((r, i) => {
        if (r instanceof Error) { failed++; const held = cache.uploads[channels[i].id]; if (held && held.videos) all.push(...held.videos.slice(0, 5)); return; }
        all.push(...r);
    });
    if (failed && failed === channels.length && channels.length) throw got.find((r) => r instanceof Error);
    const seen = new Set();
    const merged = all.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true))).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 80);
    const videos = await withDetails(merged);
    feedMemo = { at: Date.now(), videos, channels: channels.length, partial: partial || failed > 0 };
    return feedMemo;
}

async function channelPage(id) {
    if (!CHANNEL_ID.test(String(id || ''))) throw fail('That is not a channel', 'YOUTUBE_BAD_CHANNEL');
    const videos = await withDetails(await uploadsOf(id, { max: 25 }));
    let channel = (cache.subs && cache.subs.list.find((c) => c.id === id)) || acct.favourites.find((c) => c.id === id) || null;
    if (!channel) {
        const d = await api('channels', { part: 'snippet', id, maxResults: '1' });
        const c = d.items && d.items[0];
        channel = cleanChannel({ id, title: plain(c && c.snippet && c.snippet.title) || (videos[0] && videos[0].channel), thumb: thumbOf(c && c.snippet && c.snippet.thumbnails) });
    }
    return { channel, videos, favourite: acct.favourites.some((f) => f.id === id), subscribed: !!(cache.subs && cache.subs.list.some((c) => c.id === id)) };
}

async function search(query, page) {
    const q = String(query || '').trim().slice(0, 120);
    if (!q) throw fail('Type what to look for', 'YOUTUBE_BAD_QUERY');
    const key = `${q.toLowerCase()}|${page || ''}`;
    const held = searches.get(key);
    if (held && Date.now() - held.at < SEARCH_TTL) return held.data;
    const p = { part: 'snippet', q, type: 'video,channel', maxResults: '25', safeSearch: 'none' };
    if (page) p.pageToken = String(page);
    const d = await api('search', p, 100);
    const videos = [];
    const channels = [];
    (d.items || []).forEach((it) => {
        const s = it.snippet || {};
        const k = it.id || {};
        if (k.videoId && VIDEO_ID.test(k.videoId)) {
            videos.push({ id: k.videoId, title: plain(s.title), channel: plain(s.channelTitle), channelId: s.channelId || '', thumb: thumbOf(s.thumbnails, k.videoId), at: Date.parse(s.publishedAt) || null, length: null, live: s.liveBroadcastContent === 'live' ? 'live' : s.liveBroadcastContent === 'upcoming' ? 'upcoming' : '' });
        } else if (k.channelId) {
            const c = cleanChannel({ id: k.channelId, title: plain(s.channelTitle || s.title), thumb: thumbOf(s.thumbnails) });
            if (c) channels.push(c);
        }
    });
    const data = { query: q, videos: await withDetails(videos), channels, next: d.nextPageToken || '' };
    searches.set(key, { at: Date.now(), data });
    if (searches.size > 40) searches.delete(searches.keys().next().value);
    return data;
}

// ------------------------------------------------------------------------------------------ Watch Later

/** Video ids in list order out of an app-interface answer, whatever list shape it used. */
function listedVideoIds(node, out = [], seen = new Set()) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { node.forEach((n) => listedVideoIds(n, out, seen)); return out; }
    const take = (id) => { if (typeof id === 'string' && VIDEO_ID.test(id) && !seen.has(id)) { seen.add(id); out.push(id); } };
    for (const k of Object.keys(node)) {
        const v = node[k];
        if (k === 'tileRenderer' && v && /VIDEO/.test(String(v.contentType || 'VIDEO'))) { take(v.contentId || (v.onSelectCommand && v.onSelectCommand.watchEndpoint && v.onSelectCommand.watchEndpoint.videoId)); continue; }
        if (k === 'lockupViewModel' && v && /VIDEO/.test(String(v.contentType || ''))) { take(v.contentId); continue; }
        if ((k === 'playlistVideoRenderer' || k === 'playlistPanelVideoRenderer' || k === 'compactVideoRenderer' || k === 'videoRenderer' || k === 'gridVideoRenderer') && v) { take(v.videoId); continue; }
        listedVideoIds(v, out, seen);
    }
    return out;
}

const APP_CLIENTS = [
    { clientName: 'TVHTML5', clientVersion: '7.20250219.14.00' },
    { clientName: 'WEB', clientVersion: '2.20251110.00.00' }
];

async function watchLater(opts = {}) {
    if (!signedIn()) throw fail('Sign in to YouTube first', 'YOUTUBE_SIGNIN');
    if (watchLater.memo && !opts.fresh && Date.now() - watchLater.memo.at < UPLOADS_TTL) return watchLater.memo.data;
    const token = await accessToken();
    let ids = [];
    for (const client of APP_CLIENTS) {
        try {
            const res = await fetch(`${APP_API}/browse?prettyPrint=false`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ context: { client: Object.assign({ hl: 'en', gl: 'US' }, client) }, browseId: 'VLWL' }),
                signal: AbortSignal.timeout(20000)
            });
            if (res.status !== 200) continue;
            ids = listedVideoIds(await res.json().catch(() => null));
            if (ids.length) break;
        } catch (_e) { /* the next shape, then the plain answer below */ }
    }
    const data = ids.length
        ? { videos: await withDetails(ids.slice(0, 100).map((id) => ({ id, title: '', channel: '', channelId: '', thumb: '', at: null, length: null, live: '' }))), unavailable: false }
        : { videos: [], unavailable: true };
    if (ids.length) watchLater.memo = { at: Date.now(), data };
    return data;
}

// ------------------------------------------------------------------------------------------ favourites on Today

function latestVideos() {
    const all = [];
    acct.favourites.forEach((f) => {
        const held = cache.uploads[f.id];
        if (held && Array.isArray(held.videos)) all.push(...held.videos.slice(0, 5));
    });
    const seen = new Set();
    return all.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true))).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, settings().todayCount).map((v) => {
        const d = cache.details[v.id];
        return d && !d.gone ? Object.assign({}, v, { length: d.length, live: d.live }) : v;
    });
}

/** Reads the favourites whose uploads are older than 15 minutes; pushes when something changed. */
function refreshLatest(force) {
    if (refreshing || !signedIn() || !acct.favourites.length) return refreshing;
    const due = acct.favourites.filter((f) => {
        const held = cache.uploads[f.id];
        return !held || Date.now() - held.triedAt >= (force ? FEED_MIN_GAP : LATEST_TTL);
    });
    if (!due.length) return null;
    const before = JSON.stringify(latestVideos());
    refreshing = (async () => {
        try {
            const got = await pool(due, 4, (f) => uploadsOf(f.id, { max: 5, ttl: force ? FEED_MIN_GAP : LATEST_TTL }));
            const bad = got.find((r) => r instanceof Error);
            lastError = bad && got.every((r) => r instanceof Error) ? bad.message : '';
            await withDetails(latestVideos());
        } catch (e) {
            lastError = e.message;
        } finally {
            refreshing = null;
        }
        if (JSON.stringify(latestVideos()) !== before || lastError) poke();
    })();
    return refreshing;
}

// ------------------------------------------------------------------------------------------ state and the pushed feed

function accountView() {
    return {
        configured: !!oauthClient(),
        signedIn: signedIn(),
        account: signedIn() ? acct.account : null,
        signIn: signInView(),
        error: lastError || ''
    };
}

function hubItems() {
    refreshLatest(false);
    return { account: accountView(), favourites: acct.favourites.slice(), latest: { videos: signedIn() ? latestVideos() : [] }, settings: settings() };
}

function getState() {
    return Object.assign(hubItems(), { quota: quota() });
}

function poke() {
    if (hub) hub.poke();
}

function defineFeed(statusHub) {
    if (hub || !statusHub) return hub;
    hub = statusHub.define({
        name: 'youtube',
        pushType: 'youtube_status',
        intervalMs: HUB_INTERVAL,
        allow: (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || ''))),
        sample: async () => hubItems()
    });
    return hub;
}

module.exports = {
    bind,
    defineFeed,
    getState,
    signInStart,
    signInCancel,
    signOut,
    subscriptions,
    feed,
    watchLater,
    search,
    channelPage,
    setFavourite,
    orderFavourites,
    saveSettings,
    refreshLatest,
    quota,
    YouTubeError,
    _test: { seconds, plain, listedVideoIds, latestVideos, cleanChannel, pacificDay, reset() { acct = { token: {}, account: null, favourites: [], settings: {} }; cache = { subs: null, uploads: {}, details: {} }; pending = null; usage = null; feedMemo = null; searches.clear(); watchLater.memo = null; lastError = ''; }, setToken(t) { acct.token = t; }, setUsage(n) { usage = { day: pacificDay(), units: n }; }, state: () => ({ acct, cache }) }
};
