/**
 * Melaton Videos: the sources beside YouTube (Yozora #861). Yukimi, Nov 15 2026: the YouTube program
 * becomes "a more larger videos app that has access to a few other streaming services like Kick active
 * live streams, and you can add android apps that post notifications and it can read and import them
 * into the feed".
 *
 *   Kick           channels added by name (no Kick login). Their live state comes from Kick's published
 *                  API with an app's own key (Service key `kick`: a Kick developer app's Client ID and
 *                  secret), one call for up to 50 channels, at most every 3 minutes and only while
 *                  someone is looking (the YouTube status feed's sample calls liveItems()). A failure
 *                  is quiet and the last known state stays for a while. A channel's bell (kickNotify)
 *                  makes the server look by itself every 2 minutes and tell when it goes live.
 *   App notices    the phone relays its notifications over ActiveSync when "Send notifications" is on
 *                  (modules/activeSync.js, event notify.posted: package, app, title, text, time). The
 *                  notifications of the apps chosen here are kept as feed items. A tap on the phone that
 *                  posted one opens what the notification itself opens (its key, when the phone said
 *                  `opens`); elsewhere it starts the app.
 *                  Every app that posted lately is remembered by name so it can be chosen from a list.
 *
 * Items look like the YouTube program's videos, with `source` ('kick' | 'app'), and ids that cannot be
 * YouTube's: 'kick:<slug>' and 'app:<n>'. State in .cache/videos-sources.json (no secrets).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = process.env.VIDEOS_SOURCES_FILE || path.join(__dirname, '..', '.cache', 'videos-sources.json');
const KICK = process.env.VIDEOS_KICK_BASE || 'https://api.kick.com/public/v1';
const MIN = 60000;
const KICK_TTL = 3 * MIN;
const MAX_KICK = 60;
const MAX_APPS = 30;
const MAX_NOTICES = 300;
const NOTICE_KEEP = 14 * 24 * 60 * MIN;
const SEEN_KEEP = 30 * 24 * 60 * MIN;
const SLUG = /^[a-z0-9_-]{2,40}$/;
const PACKAGE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;

class SourceError extends Error {
    constructor(message, code) { super(message); this.code = code || 'VIDEOS_SOURCE'; }
}

let state = null; // { kick: [{ slug, name, thumb }], apps: [{ package, label }], notices: [...], seenApps: { pkg: { label, at } }, serial }
let live = {}; // slug -> { at, tried, item | null }
let kickBusy = null;
const listeners = [];

function load() {
    if (state) return state;
    let s = null;
    try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_e) { /* first run */ }
    state = {
        kick: Array.isArray(s && s.kick) ? s.kick.filter((c) => c && SLUG.test(String(c.slug))) : [],
        apps: Array.isArray(s && s.apps) ? s.apps.filter((a) => a && PACKAGE.test(String(a.package))) : [],
        notices: Array.isArray(s && s.notices) ? s.notices : [],
        seenApps: s && s.seenApps && typeof s.seenApps === 'object' ? s.seenApps : {},
        serial: Number(s && s.serial) || 0
    };
    return state;
}

let saveTimer = null;
function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            fs.mkdirSync(path.dirname(FILE), { recursive: true });
            fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state));
            fs.renameSync(`${FILE}.tmp`, FILE);
        } catch (e) {
            console.warn(`[videos] sources not saved: ${e.message}`);
        }
    }, 500);
    if (saveTimer.unref) saveTimer.unref();
}

const changed = () => { listeners.forEach((fn) => { try { fn(); } catch (_e) { /* a listener's own fault */ } }); };
/** Called when live states or imported notices changed (the YouTube service pushes its status feed). */
const onChange = (fn) => { if (typeof fn === 'function') listeners.push(fn); };

// ------------------------------------------------------------------------------------------ Kick
//
// Kick's published API (docs.kick.com): an app's own token (client credentials: Service key `kick`, Client ID
// + client secret from a Kick developer app) reads public channel data, which includes the live stream.
// kick.com's own site interface is not used: it refuses programs (403 from this server).

const KICK_ID = process.env.VIDEOS_KICK_ID_BASE || 'https://id.kick.com';
let gr = null;
let kickToken = { value: '', until: 0, client: '' };
let kickError = ''; // why the last look at Kick failed ('' when it worked)

function bind(globalResources) {
    if (globalResources && !gr) gr = globalResources;
    return module.exports;
}

function kickKey() {
    try {
        const manager = gr && gr.getApiKeyManager && gr.getApiKeyManager();
        const k = manager && manager.getServiceKeys('kick')[manager.getSelectedIndex('kick')];
        return k && k.clientId && k.apiKey ? { clientId: String(k.clientId).trim(), secret: String(k.apiKey).trim() } : null;
    } catch (_e) {
        return null;
    }
}
const kickReady = () => !!kickKey();

async function kickAccess() {
    const key = kickKey();
    if (!key) throw new SourceError('Kick needs its key first: the administrator adds one on the desktop under Service keys > Kick.', 'KICK_NO_KEY');
    if (kickToken.value && kickToken.client === key.clientId && Date.now() < kickToken.until - MIN) return kickToken.value;
    let res;
    try {
        res = await fetch(`${KICK_ID}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: key.clientId, client_secret: key.secret }).toString(), signal: AbortSignal.timeout(12000) });
    } catch (e) {
        throw new SourceError(`Kick could not be reached (${e.message})`, 'KICK_NETWORK');
    }
    const j = await res.json().catch(() => ({}));
    if (res.status !== 200 || !j.access_token) throw new SourceError('Kick did not accept the key (Service keys > Kick)', 'KICK_KEY');
    kickToken = { value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000, client: key.clientId };
    return kickToken.value;
}

async function kickGet(pathAndQuery) {
    const token = await kickAccess();
    let res;
    try {
        res = await fetch(`${KICK}${pathAndQuery}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) });
    } catch (e) {
        throw new SourceError(`Kick could not be reached (${e.message})`, 'KICK_NETWORK');
    }
    if (res.status === 401) { kickToken.value = ''; throw new SourceError('Kick did not accept the key (Service keys > Kick)', 'KICK_KEY'); }
    if (res.status !== 200) throw new SourceError(`Kick answered ${res.status}`, 'KICK_REFUSED');
    const j = await res.json().catch(() => null);
    return (j && Array.isArray(j.data) ? j.data : []);
}

const https = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');

/** Channels by name (50 a call): [{ channel: { slug, name, thumb, userId }, item | null }]. */
async function kickRead(slugs) {
    const out = [];
    for (let i = 0; i < slugs.length; i += 50) {
        const part = slugs.slice(i, i + 50);
        const rows = await kickGet(`/channels?${part.map((x) => `slug=${encodeURIComponent(x)}`).join('&')}`);
        // names and pictures are the users' (a second call, 50 ids at a time)
        const ids = rows.map((r) => r.broadcaster_user_id).filter(Boolean);
        let users = [];
        try { if (ids.length) users = await kickGet(`/users?${ids.map((x) => `id=${encodeURIComponent(x)}`).join('&')}`); } catch (_e) { /* the names fall back to the address */ }
        const byId = new Map(users.map((u) => [String(u.user_id), u]));
        rows.forEach((r) => {
            if (!r || !SLUG.test(String(r.slug || '').toLowerCase())) return;
            const u = byId.get(String(r.broadcaster_user_id)) || {};
            const channel = { slug: String(r.slug).toLowerCase(), name: String(u.name || r.slug).slice(0, 80), thumb: https(u.profile_picture), userId: r.broadcaster_user_id || null };
            const st = r.stream || {};
            let item = null;
            if (st.is_live) {
                item = {
                    id: `kick:${channel.slug}`, source: 'kick', title: String(r.stream_title || `${channel.name} is live`).slice(0, 200), channel: channel.name, channelId: `kick:${channel.slug}`,
                    thumb: https(st.thumbnail) || channel.thumb, at: Date.parse(st.start_time) || Date.now(), length: null, live: 'live',
                    viewers: Number(st.viewer_count) || 0, note: r.category && r.category.name ? String(r.category.name).slice(0, 60) : '', url: `https://kick.com/${channel.slug}`
                };
            }
            out.push({ channel, item });
        });
    }
    return out;
}

async function kickAdd(name) {
    const s = load();
    const slug = String(name || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?kick\.com\//, '').replace(/[/?#].*$/, '').replace(/\s+/g, '');
    if (!SLUG.test(slug)) throw new SourceError('Type the channel\'s name as it is in its Kick address', 'KICK_BAD_NAME');
    if (s.kick.length >= MAX_KICK && !s.kick.some((c) => c.slug === slug)) throw new SourceError(`The list holds ${MAX_KICK} Kick channels`, 'KICK_FULL');
    const r = (await kickRead([slug]))[0];
    if (!r) throw new SourceError('Kick has no channel by that name', 'KICK_NOT_FOUND');
    const had = s.kick.find((c) => c.slug === r.channel.slug);
    s.kick = s.kick.filter((c) => c.slug !== r.channel.slug).concat([Object.assign({}, r.channel, had ? { notify: !!had.notify, toldStart: had.toldStart } : {})]);
    live[r.channel.slug] = { at: Date.now(), tried: Date.now(), item: r.item };
    save();
    changed();
    return { channel: r.channel, live: !!r.item, channels: s.kick.slice() };
}

/**
 * The bell on a Kick channel (Yukimi, Nov 18 2026: "a toggle so we get a server push notification as soon as
 * they go live"). While any channel has it on, the server looks at Kick by itself (nobody need be watching the
 * feed): one request for all channels every 2 minutes, slower after failures (doubling, 16 minutes at most).
 * A channel that went live is told once per stream (its start time is remembered).
 */
function kickNotify(slug, on) {
    const s = load();
    const c = s.kick.find((x) => x.slug === String(slug || '').toLowerCase());
    if (!c) throw new SourceError('That channel is not on the list', 'KICK_NOT_LISTED');
    c.notify = !!on;
    // already live when the bell is set: that stream is not news
    const held = live[c.slug];
    if (c.notify && held && held.item) c.toldStart = held.item.at;
    save();
    watchKick();
    changed();
    return view().kick;
}

const WATCH_MS = 2 * MIN;
let watchTimer = null;
let watchFails = 0;
let onLive = null; // (channel, item) => the notification (set by the handler)

function watchKick() {
    const want = load().kick.some((c) => c.notify) && kickReady();
    if (!want) { clearTimeout(watchTimer); watchTimer = null; return; }
    if (watchTimer) return;
    const tick = async () => {
        watchTimer = null;
        Object.values(live).forEach((x) => { x.tried = 0; });
        try { await kickRefresh(); } catch (_e) { /* counted below */ }
        watchFails = kickError ? Math.min(watchFails + 1, 3) : 0;
        if (load().kick.some((c) => c.notify)) {
            watchTimer = setTimeout(tick, WATCH_MS * 2 ** watchFails);
            if (watchTimer.unref) watchTimer.unref();
        }
    };
    watchTimer = setTimeout(tick, 5000);
    if (watchTimer.unref) watchTimer.unref();
}

/** After a look at Kick: the channels with the bell on whose stream is new are told, once per stream. */
function tellLive() {
    const s = load();
    let touched = false;
    s.kick.forEach((c) => {
        const item = live[c.slug] && live[c.slug].item;
        if (!c.notify || !item || c.toldStart === item.at) return;
        c.toldStart = item.at;
        touched = true;
        if (onLive) { try { onLive({ slug: c.slug, name: c.name, thumb: c.thumb }, item); } catch (e) { console.warn(`[videos] go-live notice: ${e.message}`); } }
    });
    if (touched) save();
}

function kickRemove(slug) {
    const s = load();
    s.kick = s.kick.filter((c) => c.slug !== String(slug || '').toLowerCase());
    delete live[String(slug || '').toLowerCase()];
    save();
    changed();
    return s.kick.slice();
}

/** Asks Kick about the channels when their state is older than 3 minutes (one call for 50); tells listeners when someone went live or off. */
function kickRefresh() {
    const s = load();
    const now = Date.now();
    if (!s.kick.length || kickBusy || !kickReady()) return kickBusy;
    if (s.kick.every((c) => live[c.slug] && now - live[c.slug].tried < KICK_TTL)) return null;
    const before = JSON.stringify(liveNow().map((i) => [i.id, i.title]));
    s.kick.forEach((c) => { live[c.slug] = Object.assign({ at: 0, item: null }, live[c.slug], { tried: now }); });
    kickBusy = (async () => {
        try {
            const rows = await kickRead(s.kick.map((c) => c.slug));
            const by = new Map(rows.map((r) => [r.channel.slug, r]));
            let touched = false;
            s.kick.forEach((c) => {
                const r = by.get(c.slug);
                const held = live[c.slug];
                if (!r) { if (Date.now() - held.at > 4 * KICK_TTL) held.item = null; return; }
                held.at = Date.now();
                held.item = r.item;
                if (r.channel.name !== c.name || r.channel.thumb !== c.thumb) { c.name = r.channel.name; c.thumb = r.channel.thumb; touched = true; }
            });
            if (touched) save();
            kickError = '';
            tellLive();
        } catch (e) {
            // the last known state stays, but not for ever; said once per kind of failure, not on every look
            if (kickError !== e.message) { kickError = e.message; console.warn(`[videos] Kick's live states could not be read: ${e.message}`); }
            s.kick.forEach((c) => { const held = live[c.slug]; if (held && Date.now() - held.at > 4 * KICK_TTL) held.item = null; });
        } finally {
            kickBusy = null;
        }
        if (JSON.stringify(liveNow().map((i) => [i.id, i.title])) !== before) changed();
    })();
    return kickBusy;
}

const liveNow = () => load().kick.map((c) => live[c.slug] && live[c.slug].item).filter(Boolean).sort((a, b) => (b.viewers || 0) - (a.viewers || 0));

/** Who is live now (what is held); a look at Kick runs behind it when the state is old. */
function liveItems() {
    kickRefresh();
    return liveNow();
}

// ------------------------------------------------------------------------------------------ app notifications

function prune(s) {
    const now = Date.now();
    s.notices = s.notices.filter((n) => now - n.at < NOTICE_KEEP).slice(0, MAX_NOTICES);
    Object.keys(s.seenApps).forEach((p) => { if (now - s.seenApps[p].at > SEEN_KEEP) delete s.seenApps[p]; });
}

/** A notification the phone relayed (ActiveSync notify.posted detail). Kept when its app was chosen. */
function takeNotification(detail, deviceId) {
    const d = detail && typeof detail === 'object' ? detail : null;
    if (!d || !PACKAGE.test(String(d.package || ''))) return false;
    const s = load();
    const pkg = String(d.package);
    const label = String(d.app || pkg).slice(0, 80);
    const known = s.seenApps[pkg];
    if (!known || known.label !== label || Date.now() - known.at > 60 * MIN) { s.seenApps[pkg] = { label, at: Date.now() }; save(); }
    if (!s.apps.some((a) => a.package === pkg)) return false;
    const title = String(d.title || '').trim().slice(0, 200);
    const text = String(d.text || '').trim().slice(0, 500);
    if (!title && !text) return false;
    const at = Number(d.time) > 0 ? Number(d.time) : Date.now();
    // the same notification updated in place, or posted again: one feed item
    const same = s.notices.find((n) => n.package === pkg && ((d.key && n.key === d.key) || (n.title === title && n.text === text && Math.abs(n.at - at) < 30 * MIN)));
    if (same) {
        if (same.title === title && same.text === text) return false;
        Object.assign(same, { title, text, at, key: String(d.key || same.key || '').slice(0, 200), device: String(deviceId || same.device || ''), opens: !!d.opens });
    } else {
        s.serial += 1;
        s.notices.unshift({ n: s.serial, key: String(d.key || '').slice(0, 200), device: String(deviceId || ''), opens: !!d.opens, package: pkg, app: label, title, text, at });
    }
    s.notices.sort((a, b) => b.at - a.at);
    prune(s);
    save();
    changed();
    return true;
}

const noticeItems = () => load().notices.map((n) => ({
    id: `app:${n.n}`, source: 'app', title: n.title || n.text, channel: n.app, channelId: `app:${n.package}`, thumb: '', at: n.at, length: null, live: '',
    note: n.title ? n.text : '', package: n.package,
    // what a tap on the notification opens, for the phone that posted it (DSApp AndroidActiveSync.openNotification)
    key: n.opens ? n.key : '', device: n.opens ? n.device || '' : ''
}));

function noticeRemove(id) {
    const s = load();
    const n = Number(String(id || '').replace(/^app:/, ''));
    const before = s.notices.length;
    s.notices = s.notices.filter((x) => x.n !== n);
    if (s.notices.length !== before) { save(); changed(); }
    return s.notices.length !== before;
}

function appsSave(list) {
    const s = load();
    const out = [];
    (Array.isArray(list) ? list : []).forEach((a) => {
        const pkg = String((a && a.package) || '');
        if (!PACKAGE.test(pkg) || out.some((x) => x.package === pkg) || out.length >= MAX_APPS) return;
        out.push({ package: pkg, label: String((a && a.label) || (s.seenApps[pkg] && s.seenApps[pkg].label) || pkg).slice(0, 80) });
    });
    s.apps = out;
    // what an app posted is its feed's: gone with the app
    s.notices = s.notices.filter((n) => out.some((a) => a.package === n.package));
    save();
    changed();
    return out.slice();
}

/** What the program's Channels page shows: Kick channels (with who is live), chosen apps, apps that posted lately. */
function view() {
    const s = load();
    return {
        kickReady: kickReady(),
        kickError,
        kick: s.kick.map((c) => ({ slug: c.slug, name: c.name, thumb: c.thumb, live: !!(live[c.slug] && live[c.slug].item), notify: !!c.notify })),
        apps: s.apps.slice(),
        seenApps: Object.keys(s.seenApps).map((p) => ({ package: p, label: s.seenApps[p].label })).sort((a, b) => a.label.localeCompare(b.label))
    };
}

module.exports = {
    bind, kickAdd, kickNotify, watchKick, setOnLive(fn) { onLive = typeof fn === 'function' ? fn : null; }, kickRemove, liveItems, takeNotification, noticeItems, noticeRemove, appsSave, view, onChange, SourceError,
    _test: { reset() { state = null; live = {}; kickBusy = null; listeners.length = 0; kickToken = { value: '', until: 0, client: '' }; gr = null; clearTimeout(watchTimer); watchTimer = null; watchFails = 0; onLive = null; kickError = ''; }, busy: () => kickBusy, live: () => live, load }
};
