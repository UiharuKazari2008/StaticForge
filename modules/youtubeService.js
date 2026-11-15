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
 *   subscriptions  subscriptions.list mine=true (1 unit per 50 channels), kept 6 hours for the Channels
 *                  tab. Each page also carries every channel's video count, which is how the feed
 *                  knows who uploaded: one pass (10 units for 473 channels) instead of a call a channel.
 *   uploads        YouTube's public feed of the channel's list (no quota, no sign-in), playlistItems.list
 *                  (1 unit) only when the feeds are down; "UULF" + id = the channel's long videos only
 *                  (Leave Out Shorts). Kept on disk for good and read again only when the channel's
 *                  video count changed, or after a week.
 *   feed           answered at once from what is held; a look for new uploads runs behind it at most
 *                  every 10 minutes and the status feed's `feed.at` tells the program to read again.
 *   details        videos.list (1 unit per 50 videos): length, live state; kept for good
 *   search         search.list (100 units), each answer kept 10 minutes
 *   Watch Later    the Data API does not give this list to any program (it answers empty since 2016)
 *                  and YouTube's app interface refuses this sign-in (403, tested Nov 15 2026), so the
 *                  ids are read in the server's Alchemy browser (modules/youtubeAlchemy.js, #840) and
 *                  their details through the Data API. { unavailable: true, why } when Alchemy is not
 *                  signed in to YouTube or not running.
 *   bells          importBellFavourites(): the same browser reads each subscribed channel's
 *                  notification bell; the ones set to All become Today favourites.
 *
 * Quota: the project's 10,000 units a day are shared with VisionCaster. Units are counted per Pacific
 * day in .cache/youtube-usage.json and stop at settings.budget (6,000) with a plain message.
 *
 * Push, never poll (rule server-push-not-polling): statusHub feed `youtube` (push type
 * youtube_status) carries { account, favourites, latest, settings }. The feed's one timer runs only
 * while a phone shows the Today item or the program; it re-reads a favourite channel's uploads when
 * they are older than 15 minutes and pushes only
 * what changed. Today's list is one list: every favourite's uploads together, newest first.
 *
 * Files (all under .cache): youtube-account.json (0600: token, account, favourites, settings),
 * youtube-cache.json (subscriptions, uploads, video details), youtube-usage.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GOOGLE = process.env.YOUTUBE_GOOGLE_BASE || 'https://oauth2.googleapis.com';
const API = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';
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
const DEFAULTS = { noShorts: true, rareFirst: true, todayCount: 12, budget: 6000 };
// No small cap on favourites (Yukimi, Nov 15 2026: an import of every channel with its bell on must fit).
// A long list is cheap to watch: one unit tells whether any of 50 channels uploaded (refreshLatest).
const MAX_FAVOURITES = 1000;
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
        rareFirst: s.rareFirst === undefined ? DEFAULTS.rareFirst : !!s.rareFirst,
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
        rareFirst: next && next.rareFirst !== undefined ? !!next.rareFirst : cur.rareFirst,
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

/**
 * The subscribed channels, A to Z. Each page also says how many videos a channel has
 * (contentDetails.totalItemCount, equal to the channel's public video count): kept in cache.subs.counts,
 * it tells which channels uploaded since their list was last read, for 1 unit per 50 channels.
 * opts.maxAge: answer from what is held when it is younger (default 6 hours; the feed asks for 10 minutes).
 */
async function subscriptions(opts = {}) {
    if (!signedIn()) throw fail('Sign in to YouTube first', 'YOUTUBE_SIGNIN');
    const held = cache.subs;
    const maxAge = opts.maxAge || (opts.fresh ? FEED_MIN_GAP : SUBS_TTL);
    if (held && Array.isArray(held.list) && Date.now() - held.at < maxAge) return held.list;
    if (subscriptions.busy) return subscriptions.busy;
    subscriptions.busy = (async () => {
        const list = [];
        const counts = {};
        let pageToken = '';
        for (let page = 0; page < 40; page++) {
            const p = { part: 'snippet,contentDetails', mine: 'true', maxResults: '50', order: 'alphabetical' };
            if (pageToken) p.pageToken = pageToken;
            const d = await api('subscriptions', p);
            (d.items || []).forEach((it) => {
                const sn = it.snippet || {};
                const c = cleanChannel({ id: sn.resourceId && sn.resourceId.channelId, title: plain(sn.title), thumb: thumbOf(sn.thumbnails) });
                if (!c) return;
                list.push(c);
                const n = it.contentDetails && Number(it.contentDetails.totalItemCount);
                if (Number.isFinite(n)) counts[c.id] = n;
            });
            pageToken = d.nextPageToken || '';
            if (!pageToken) break;
        }
        cache.subs = { at: Date.now(), list, counts };
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
    })();
    try { return await subscriptions.busy; } finally { subscriptions.busy = null; }
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

// ---- a channel's uploads
//
// Source 1: YouTube's public feed of a list (feeds/videos.xml?playlist_id=...): the 15 newest entries with
// exact upload times, no sign-in and no quota. "UULF" + id is the channel's long videos only (Leave Out
// Shorts), "UU" + id every upload. Source 2, when the feed fails: playlistItems.list (1 unit).
// What is read is kept for good and read again only when the channel's video count changed (the
// subscriptions pass or channels.list, 1 unit per 50 channels), or after a week.

const FEEDS = process.env.YOUTUBE_FEEDS_BASE || 'https://www.youtube.com/feeds/videos.xml';
const UPLOADS_KEPT = 15;
const UPLOADS_MAX_AGE = 7 * 24 * 60 * MIN;
const COUNT_LAG = 16 * MIN; // the public feed may trail a new upload by its 15-minute cache
let feedsDownUntil = 0;

const tagText = (xml, tag) => { const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml); return m ? plain(m[1].trim()) : ''; };

/** The public feed of one list as videos; null when the list has no feed (404); throws when the feeds are down. */
async function readListFeed(playlistId, channelId) {
    let res;
    try {
        res = await fetch(`${FEEDS}?playlist_id=${encodeURIComponent(playlistId)}`, { headers: { Accept: 'application/atom+xml' }, signal: AbortSignal.timeout(12000) });
    } catch (e) {
        throw fail(`YouTube's channel feeds could not be reached (${e.message})`, 'YOUTUBE_FEEDS');
    }
    if (res.status === 404) return null;
    if (res.status !== 200) throw fail(`YouTube's channel feeds answered ${res.status}`, 'YOUTUBE_FEEDS');
    const xml = await res.text();
    if (!/<feed[\s>]/.test(xml)) throw fail('YouTube\'s channel feeds answered something else', 'YOUTUBE_FEEDS');
    const videos = [];
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const e = m[1];
        const id = tagText(e, 'yt:videoId');
        if (!VIDEO_ID.test(id)) continue;
        videos.push({
            id, title: tagText(e, 'title'), channel: tagText(e, 'name'), channelId: tagText(e, 'yt:channelId') || channelId,
            thumb: thumbOf(null, id), at: Date.parse(tagText(e, 'published')) || null, length: null, live: ''
        });
    }
    return videos;
}

async function readListApi(playlistId, channelId) {
    let d;
    try {
        d = await api('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: String(UPLOADS_KEPT) });
    } catch (e) {
        if (e.code === 'YOUTUBE_NOT_FOUND') return null;
        throw e;
    }
    const videos = [];
    (d.items || []).forEach((it) => {
        const sn = it.snippet || {};
        const id = (it.contentDetails && it.contentDetails.videoId) || (sn.resourceId && sn.resourceId.videoId);
        if (!id || !VIDEO_ID.test(id) || /^(Private|Deleted) video$/.test(sn.title || '')) return;
        videos.push({
            id, title: plain(sn.title), channel: plain(sn.videoOwnerChannelTitle || sn.channelTitle), channelId: sn.videoOwnerChannelId || sn.channelId || channelId,
            thumb: thumbOf(sn.thumbnails, id), at: Date.parse((it.contentDetails && it.contentDetails.videoPublishedAt) || sn.publishedAt) || null, length: null, live: ''
        });
    });
    return videos;
}

async function readUploads(channelId) {
    const tail = channelId.slice(2);
    const lists = settings().noShorts ? [`UULF${tail}`, `UU${tail}`] : [`UU${tail}`];
    let videos = null;
    for (const playlistId of lists) {
        // the free feed first; while the feeds are down (tried again after 10 minutes) the API answers
        if (Date.now() >= feedsDownUntil) {
            try {
                videos = await readListFeed(playlistId, channelId);
            } catch (e) {
                if (e.code !== 'YOUTUBE_FEEDS') throw e;
                feedsDownUntil = Date.now() + 10 * MIN;
                videos = await readListApi(playlistId, channelId);
            }
        } else {
            videos = await readListApi(playlistId, channelId);
        }
        if (videos) break;
    }
    return (videos || []).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, UPLOADS_KEPT);
}

/** Does this channel's list need reading: never read, its video count moved, a lagging feed, or a week old. */
function uploadsDue(id, count, now) {
    const e = cache.uploads[id];
    if (!e || !Array.isArray(e.videos) || !e.at) return true;
    if (count !== undefined && count !== null && e.count !== count) return true;
    if (e.again && now >= e.again) return true;
    return now - e.at > UPLOADS_MAX_AGE;
}

/**
 * Brings the held uploads of these channels up to date. counts: { id: video count } for the channels it
 * is known for; a channel without one is read when its list is older than opts.maxAge. Returns how many
 * lists were read and how many of those failed.
 */
async function syncUploads(ids, counts, opts = {}) {
    const now = Date.now();
    const due = ids.filter((id) => {
        const has = counts && counts[id] !== undefined;
        if (has) return uploadsDue(id, counts[id], now);
        const e = cache.uploads[id];
        return !e || !e.at || now - e.triedAt >= (opts.maxAge || UPLOADS_TTL);
    });
    if (!due.length) return { read: 0, failed: 0, error: null };
    const got = await pool(due, 12, async (id) => {
        const held = cache.uploads[id];
        const entry = cache.uploads[id] = Object.assign({ videos: [], at: 0 }, held, { triedAt: Date.now() });
        const videos = await readUploads(id);
        const known = new Set((held && held.videos ? held.videos : []).map((v) => v.id));
        const fresh = videos.some((v) => !known.has(v.id));
        const moved = !!(counts && counts[id] !== undefined && held && held.count !== undefined && held.count !== counts[id]);
        entry.videos = videos;
        entry.at = Date.now();
        if (counts && counts[id] !== undefined) entry.count = counts[id];
        // the count moved but the list shows nothing new yet (the feed's cache, or a Short left out): once more later
        entry.again = moved && !fresh && !entry.again ? Date.now() + COUNT_LAG : 0;
        return true;
    });
    saveCacheSoon();
    return { read: due.length, failed: got.filter((r) => r instanceof Error).length, error: got.find((r) => r instanceof Error) || null };
}

/** Video counts of any channels (favourites that are not subscribed too): channels.list, 1 unit per 50. */
async function channelCounts(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 50) {
        const d = await api('channels', { part: 'statistics', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
        (d.items || []).forEach((c) => { const n = Number(c.statistics && c.statistics.videoCount); if (Number.isFinite(n)) out[c.id] = n; });
    }
    return out;
}

// ---- the subscriptions feed

const FEED_TTL = 10 * MIN; // how old the feed may be before a read looks for new uploads
const FEED_SIZE = 150;
let feedBusy = null;

/** The feed from what is held: no call to YouTube. */
function feedFromCache() {
    const channels = (cache.subs && cache.subs.list) || [];
    const all = [];
    channels.forEach((c) => { const e = cache.uploads[c.id]; if (e && Array.isArray(e.videos)) all.push(...e.videos.slice(0, 5)); });
    const seen = new Set();
    return all.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true))).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, FEED_SIZE);
}

const detailed = (videos) => videos.filter((v) => !(cache.details[v.id] && cache.details[v.id].gone)).map((v) => {
    const d = cache.details[v.id];
    return d ? Object.assign({}, v, { length: d.length, live: d.live }) : v;
});

/** One look for new uploads: the subscriptions pass (its counts), the changed channels' lists, new details. */
function refreshFeed() {
    if (feedBusy) return feedBusy;
    feedBusy = (async () => {
        try {
            const channels = await subscriptions({ maxAge: FEED_TTL });
            const r = await syncUploads(channels.map((c) => c.id), (cache.subs && cache.subs.counts) || {});
            if (r.failed && r.failed === r.read && r.read === channels.length) throw r.error;
            const videos = await withDetails(feedFromCache());
            feedMemo = { at: Date.now(), videos, channels: channels.length, partial: r.failed > 0, read: r.read };
            return feedMemo;
        } finally {
            feedBusy = null;
        }
    })();
    return feedBusy;
}

/**
 * The subscriptions feed: every subscribed channel's newest uploads, newest first. A read that finds the
 * feed older than 10 minutes answers at once from what is held ({ refreshing: true }) and looks for new
 * uploads behind it; the status feed's `feed.at` then tells the program to read again. Only the very
 * first read (nothing held yet) waits. opts.fresh (the Refresh key) looks again after 2 minutes.
 */
async function feed(opts = {}) {
    if (!signedIn()) throw fail('Sign in to YouTube first', 'YOUTUBE_SIGNIN');
    const age = feedMemo ? Date.now() - feedMemo.at : Infinity;
    if (feedMemo && age < (opts.fresh ? 2 * MIN : FEED_TTL)) return Object.assign({ refreshing: !!feedBusy }, feedMemo);
    const held = cache.subs && cache.subs.list && cache.subs.list.some((c) => cache.uploads[c.id] && cache.uploads[c.id].at);
    if (!held) return Object.assign({ refreshing: false }, await refreshFeed());
    refreshFeed().then(() => poke(), (e) => { lastError = e.message; poke(); });
    return { at: feedMemo ? feedMemo.at : (cache.subs && cache.subs.at) || 0, videos: detailed(feedFromCache()), channels: cache.subs.list.length, partial: false, refreshing: true };
}

async function channelPage(id) {
    if (!CHANNEL_ID.test(String(id || ''))) throw fail('That is not a channel', 'YOUTUBE_BAD_CHANNEL');
    const r = await syncUploads([id], null, { maxAge: UPLOADS_TTL });
    if (r.failed && !(cache.uploads[id] && cache.uploads[id].at)) throw r.error;
    const videos = await withDetails((cache.uploads[id] && cache.uploads[id].videos) || []);
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

// ------------------------------------------------------------------------------------------ Watch Later and the bells (Alchemy)

// What only a signed-in browser is shown (modules/youtubeAlchemy.js, #840). `why` says what is missing:
// 'browser-signin' (Alchemy is not signed in to YouTube) or 'browser-offline' (Alchemy is not running).
let browser = require('./youtubeAlchemy');

async function browserRead(kind) {
    try {
        const r = await browser.read(kind);
        return r && r.signedIn ? Object.assign({ why: '' }, r) : { why: 'browser-signin' };
    } catch (e) {
        if (e && e.code === 'ALCHEMY_OFFLINE') return { why: 'browser-offline' };
        throw fail((e && e.message) || 'The server\'s browser could not read YouTube', (e && e.code) || 'YOUTUBE_BROWSER');
    }
}

async function watchLater(opts = {}) {
    if (!signedIn()) throw fail('Sign in to YouTube first', 'YOUTUBE_SIGNIN');
    if (watchLater.memo && !opts.fresh && Date.now() - watchLater.memo.at < UPLOADS_TTL) return watchLater.memo.data;
    const r = await browserRead('watch-later');
    if (r.why) return { videos: [], unavailable: true, why: r.why };
    const ids = (r.ids || []).filter((id) => VIDEO_ID.test(String(id))).slice(0, 300);
    const data = { videos: await withDetails(ids.map((id) => ({ id, title: '', channel: '', channelId: '', thumb: '', at: null, length: null, live: '' }))), unavailable: false, why: '', partial: !!r.partial };
    watchLater.memo = { at: Date.now(), data };
    return data;
}

/**
 * Import favourites: every subscribed channel whose bell is set to All becomes a Today favourite
 * (Yukimi, Nov 15 2026). Favourites already chosen stay; the list holds MAX_FAVOURITES.
 */
async function importBellFavourites() {
    if (!signedIn()) throw fail('Sign in to YouTube first', 'YOUTUBE_SIGNIN');
    const r = await browserRead('bells');
    if (r.why) return { why: r.why, favourites: acct.favourites.slice(), found: 0, added: 0, left: 0 };
    const channels = (r.channels || []).map((c) => Object.assign({ bell: c.bell }, cleanChannel(c) || {})).filter((c) => c.id);
    if (channels.length && !channels.some((c) => c.bell)) throw fail('YouTube\'s subscriptions page did not show the notification bells in a form this program reads.', 'YOUTUBE_BROWSER_SHAPE');
    const ringing = channels.filter((c) => c.bell === 'all');
    const have = new Set(acct.favourites.map((f) => f.id));
    let added = 0;
    let left = 0;
    for (const c of ringing) {
        if (have.has(c.id)) continue;
        if (acct.favourites.length >= MAX_FAVOURITES) { left++; continue; }
        acct.favourites.push({ id: c.id, title: c.title, thumb: c.thumb });
        have.add(c.id);
        added++;
    }
    if (added) { saveAccount(); poke(); }
    return { why: '', favourites: acct.favourites.slice(), channels: channels.length, found: ringing.length, added, left, partial: !!r.partial };
}

// ------------------------------------------------------------------------------------------ favourites on Today

const HOUR = 60 * MIN;
const DAY_MS = 24 * HOUR;

/** A channel's usual time between uploads, from the uploads held (median gap; 6 hours to 90 days). */
function cadenceOf(videos) {
    const ats = (videos || []).map((v) => v.at).filter(Boolean).sort((a, b) => b - a);
    const gaps = [];
    for (let i = 1; i < ats.length; i++) gaps.push(ats[i - 1] - ats[i]);
    if (!gaps.length) return 30 * DAY_MS; // one upload known: not a channel that uploads often
    gaps.sort((a, b) => a - b);
    const mid = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
    return Math.max(6 * HOUR, Math.min(90 * DAY_MS, mid));
}

/**
 * Today's list: every favourite's uploads together. With Rare Uploads First (Yukimi, Nov 15 2026: channels
 * that "do not upload often get higher sort") a video's age counts in units of its channel's usual gap
 * between uploads, so a three-day-old video of a monthly channel (0.1 of a gap) comes before a daily
 * channel's video of yesterday (1 gap), and a daily channel's video of an hour ago still leads. Off: newest
 * first. Each video carries `gap`, the time since the channel's upload before it (the "first in 3 weeks" note).
 */
function latestVideos(now = Date.now()) {
    const all = [];
    acct.favourites.forEach((f) => {
        const held = cache.uploads[f.id];
        if (!held || !Array.isArray(held.videos)) return;
        const cadence = cadenceOf(held.videos);
        held.videos.slice(0, 5).forEach((v, i) => {
            const older = held.videos[i + 1];
            all.push(Object.assign({}, v, { gap: v.at && older && older.at ? v.at - older.at : null, rank: v.at ? Math.max(0, now - v.at) / cadence : Infinity }));
        });
    });
    const rare = settings().rareFirst;
    const seen = new Set();
    return all.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
        .sort((a, b) => (rare ? (a.rank - b.rank) || ((b.at || 0) - (a.at || 0)) : (b.at || 0) - (a.at || 0)))
        .slice(0, settings().todayCount)
        .map((v) => {
            const d = cache.details[v.id];
            const out = d && !d.gone ? Object.assign({}, v, { length: d.length, live: d.live }) : Object.assign({}, v);
            delete out.rank;
            return out;
        });
}

/**
 * Looks for new uploads of the favourites, at most every 15 minutes while a phone shows them: their video
 * counts (the subscriptions pass when it is young, else channels.list: 1 unit per 50 channels), then only
 * the lists of the channels that uploaded. Pushes when the Today list changed.
 */
let latestCheckedAt = 0;
function refreshLatest(force) {
    if (refreshing || !signedIn() || !acct.favourites.length) return refreshing;
    const now = Date.now();
    const ids = acct.favourites.map((f) => f.id);
    const unread = ids.some((id) => !(cache.uploads[id] && cache.uploads[id].triedAt));
    if (!unread && now - latestCheckedAt < (force ? FEED_MIN_GAP : LATEST_TTL)) return null;
    latestCheckedAt = now;
    const before = JSON.stringify(latestVideos().map((v) => [v.id, v.length, v.live]));
    refreshing = (async () => {
        try {
            let counts = null;
            if (cache.subs && cache.subs.counts && now - cache.subs.at < LATEST_TTL && ids.every((id) => cache.subs.counts[id] !== undefined)) counts = cache.subs.counts;
            else { try { counts = await channelCounts(ids); } catch (e) { if (e.code === 'YOUTUBE_SIGNIN') throw e; counts = null; } }
            const r = await syncUploads(ids, counts, { maxAge: LATEST_TTL });
            lastError = r.failed && r.failed === r.read ? r.error.message : '';
            await withDetails(latestVideos());
        } catch (e) {
            lastError = e.message;
        } finally {
            refreshing = null;
        }
        if (JSON.stringify(latestVideos().map((v) => [v.id, v.length, v.live])) !== before || lastError) poke();
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
    return { account: accountView(), favourites: acct.favourites.slice(), latest: { videos: signedIn() ? latestVideos() : [] }, settings: settings(), feed: { at: feedMemo ? feedMemo.at : 0 } };
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
    importBellFavourites,
    search,
    channelPage,
    setFavourite,
    orderFavourites,
    saveSettings,
    refreshLatest,
    quota,
    YouTubeError,
    _test: { seconds, plain, latestVideos, cadenceOf, feedFromCache, feedsDown(ms) { feedsDownUntil = ms; }, clearFeed() { feedMemo = null; latestCheckedAt = 0; }, refreshing: () => refreshing || feedBusy, setBrowser(b) { browser = b; }, cleanChannel, pacificDay, reset() { acct = { token: {}, account: null, favourites: [], settings: {} }; cache = { subs: null, uploads: {}, details: {} }; pending = null; usage = null; feedMemo = null; latestCheckedAt = 0; feedsDownUntil = 0; searches.clear(); watchLater.memo = null; lastError = ''; }, setToken(t) { acct.token = t; }, setUsage(n) { usage = { day: pacificDay(), units: n }; }, state: () => ({ acct, cache }) }
};
