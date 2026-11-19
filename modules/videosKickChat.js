/**
 * Melaton Videos: a Kick stream's chat, read and written (Yozora #919). Yukimi, Nov 18 2026: "lets add the
 * live stream chat and the send data, we should not show the chat by default due to the data troughput, we
 * want to plan how we are delivering and showing it in a optimised way that does not effect battery life".
 *
 * Everything is Kick's published API (docs.kick.com):
 *
 *   Reading   an event subscription for `chat.message.sent` on the watched channel, made with the app's own
 *             token (Service key `kick`). Kick posts each message to the Webhook URL of the Kick developer
 *             app, /api/videos/kick/webhook here. Every delivery's signature is checked against Kick's public
 *             key (RSA PKCS#1 v1.5 over SHA-256 of "<message id>.<timestamp>.<body>"); an unsigned, stale or
 *             repeated one gets the cover's 404. The route is public only while chat is switched on (enabled).
 *   When      the subscription exists only while somebody has the chat panel open for that channel (watch()),
 *             and goes a minute after the last one closed it. Nothing arrives when chat is not shown.
 *   Delivery  the newest 200 messages per channel are held; viewers get one batch at most every 2 seconds
 *             (30 messages at most; a faster chat is thinned and the batch says how many were skipped), over
 *             the socket they already have. The timer runs only while there is a viewer.
 *   Emotes    a message's text carries `[emote:<id>:<NAME>]`; the picture is Kick's public file, handed out by
 *             /api/videos/kick/emote/<id> from a disk cache (the program keeps it in its own cache after that).
 *   Sending   the administrator links a Kick account once (OAuth 2.1 with PKCE, scope chat:write; the answer
 *             comes back to /api/videos/kick/oauth, which is public only for a state this server gave out in the
 *             last 10 minutes). The tokens are kept in .cache/videos-kick-chat.json (0600), never sent to a client.
 *   Go-live   with chat switched on, channels with the bell get a `livestream.status.updated` subscription too:
 *             Kick tells the moment a stream starts, and the 2-minute look (videosSources.watchKick) becomes
 *             a slow safety net.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.VIDEOS_KICK_CHAT_FILE || path.join(__dirname, '..', '.cache', 'videos-kick-chat.json');
const EMOTE_DIR = process.env.VIDEOS_KICK_EMOTE_DIR || path.join(__dirname, '..', '.cache', 'videos-kick-emotes');
const KICK = process.env.VIDEOS_KICK_BASE || 'https://api.kick.com/public/v1';
const KICK_ID = process.env.VIDEOS_KICK_ID_BASE || 'https://id.kick.com';
const EMOTE_BASE = process.env.VIDEOS_KICK_EMOTE_BASE || 'https://files.kick.com/emotes';
const WEBHOOK_PATH = '/api/videos/kick/webhook';
const OAUTH_PATH = '/api/videos/kick/oauth';
const EMOTE_PATH = '/api/videos/kick/emote';
const MIN = 60000;
const KEEP = 200; // messages held per channel
const BATCH_MS = 2000;
const BATCH_MAX = 30;
const BACKLOG = 40; // what a panel gets when it opens
const LINGER_MS = Number(process.env.VIDEOS_KICK_CHAT_LINGER_MS) || MIN; // the subscription outlives its last viewer this long (a panel closed and opened again)
const FRESH_MS = 10 * MIN; // a delivery older than this is not taken
const MAX_TEXT = 500;
const EMOTE_ID = /^[0-9]{1,12}$/;

class ChatError extends Error {
    constructor(message, code) { super(message); this.code = code || 'KICK_CHAT'; }
}

let deps = { key: () => null, appToken: async () => { throw new ChatError('Kick needs its key first', 'KICK_NO_KEY'); }, channel: () => null, bells: () => [], look: () => {}, origin: () => '', fetch: (...a) => fetch(...a), send: () => {} };
let state = null; // { enabled, user: { access, refresh, until, scope } | null }
const rooms = new Map(); // slug -> { slug, userId, messages[], serial, viewers: Map(key -> { sink, sent }), sub, subBusy, linger }
const seenIds = new Set(); // delivery ids taken lately (a repeat is dropped)
const seenOrder = [];
let publicKey = { pem: '', at: 0 };
let batchTimer = null;
const linking = new Map(); // state -> { verifier, redirect, until }
let statusSubs = new Map(); // slug -> subscription id (livestream.status.updated)
let onChanged = null;

function load() {
    if (state) return state;
    let s = null;
    try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_e) { /* first run */ }
    state = { enabled: !!(s && s.enabled), user: s && s.user && s.user.refresh ? s.user : null };
    return state;
}

function save() {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state), { mode: 0o600 });
        fs.renameSync(`${FILE}.tmp`, FILE);
    } catch (e) {
        console.warn(`[videos] Kick chat state not saved: ${e.message}`);
    }
}

function bind(d) {
    deps = Object.assign(deps, d || {});
    return module.exports;
}

const enabled = () => load().enabled;
const linked = () => !!(load().user && load().user.refresh);
const origin = () => String(deps.origin() || '').replace(/\/+$/, '');

function status() {
    const o = origin();
    return { enabled: enabled(), linked: linked(), ready: !!deps.key(), webhookUrl: o ? `${o}${WEBHOOK_PATH}` : '', redirectUrl: o ? `${o}${OAUTH_PATH}` : '' };
}

// ------------------------------------------------------------------------------------------ Kick calls

async function call(method, url, { token, json, form } = {}) {
    let res;
    try {
        res = await deps.fetch(url, {
            method,
            headers: Object.assign({ Accept: 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}, json ? { 'Content-Type': 'application/json' } : {}, form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            body: json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : undefined,
            signal: AbortSignal.timeout(12000)
        });
    } catch (e) {
        throw new ChatError(`Kick could not be reached (${e.message})`, 'KICK_NETWORK');
    }
    let body = null;
    if (res.status !== 204) body = await res.json().catch(() => null);
    return { status: res.status, body };
}

async function kickPublicKey(fresh) {
    if (!fresh && publicKey.pem && Date.now() - publicKey.at < 24 * 60 * MIN) return publicKey.pem;
    const r = await call('GET', `${KICK}/public-key`);
    const pem = r.body && r.body.data && typeof r.body.data.public_key === 'string' ? r.body.data.public_key : '';
    if (r.status !== 200 || !/BEGIN PUBLIC KEY/.test(pem)) throw new ChatError('Kick\'s public key could not be read', 'KICK_PUBLIC_KEY');
    publicKey = { pem, at: Date.now() };
    return pem;
}

/** Is this delivery Kick's? (the signature over "<id>.<timestamp>.<body>", the key read again once when it fails) */
async function verify(id, timestamp, raw, signature) {
    if (!id || !timestamp || !signature || !raw || !raw.length) return false;
    const at = Date.parse(timestamp);
    if (!Number.isFinite(at) || Math.abs(Date.now() - at) > FRESH_MS) return false;
    let sig;
    try { sig = Buffer.from(String(signature), 'base64'); } catch (_e) { return false; }
    if (!sig.length) return false;
    const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), raw]);
    const check = (pem) => { try { return crypto.verify('RSA-SHA256', signed, pem, sig); } catch (_e) { return false; } };
    try {
        if (check(await kickPublicKey(false))) return true;
        // Kick may have changed its key: one fresh read, at most every 5 minutes
        if (Date.now() - publicKey.at > 5 * MIN) return check(await kickPublicKey(true));
    } catch (_e) { /* no key: not verified */ }
    return false;
}

// ------------------------------------------------------------------------------------------ subscriptions

async function subscribe(userId, name) {
    const token = await deps.appToken();
    const r = await call('POST', `${KICK}/events/subscriptions`, { token, json: { broadcaster_user_id: Number(userId), events: [{ name, version: 1 }], method: 'webhook' } });
    const row = r.body && Array.isArray(r.body.data) ? r.body.data[0] : null;
    if (r.status !== 200 || !row || !row.subscription_id) throw new ChatError((row && row.error) || `Kick answered ${r.status} to the subscription`, 'KICK_SUBSCRIBE');
    return String(row.subscription_id);
}

async function unsubscribe(ids) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return;
    try {
        const token = await deps.appToken();
        await call('DELETE', `${KICK}/events/subscriptions?${list.map((x) => `id=${encodeURIComponent(x)}`).join('&')}`, { token });
    } catch (e) {
        console.warn(`[videos] Kick subscription not removed: ${e.message}`);
    }
}

/** After a start: subscriptions left from a run that ended without tidying are removed (chat nobody reads). */
async function tidy() {
    if (!deps.key()) return;
    try {
        const token = await deps.appToken();
        const r = await call('GET', `${KICK}/events/subscriptions`, { token });
        const rows = r.body && Array.isArray(r.body.data) ? r.body.data : [];
        const keep = new Set([...rooms.values()].map((x) => x.sub).concat([...statusSubs.values()]));
        await unsubscribe(rows.filter((x) => x && (x.event === 'chat.message.sent' || x.event === 'livestream.status.updated') && !keep.has(String(x.id))).map((x) => String(x.id)));
    } catch (_e) { /* next start */ }
    syncBells();
}

/** Channels with the bell: Kick tells when they go live (while chat's webhook is on). */
let bellsBusy = false;
async function syncBells() {
    if (bellsBusy) return;
    bellsBusy = true;
    try {
        const want = enabled() && deps.key() ? deps.bells() : [];
        const wantSlugs = new Set(want.map((c) => c.slug));
        const gone = [...statusSubs.keys()].filter((slug) => !wantSlugs.has(slug));
        if (gone.length) { await unsubscribe(gone.map((slug) => statusSubs.get(slug))); gone.forEach((slug) => statusSubs.delete(slug)); }
        for (const c of want) {
            if (statusSubs.has(c.slug) || !c.userId) continue;
            try { statusSubs.set(c.slug, await subscribe(c.userId, 'livestream.status.updated')); } catch (e) { console.warn(`[videos] Kick go-live subscription for ${c.slug}: ${e.message}`); }
        }
    } finally {
        bellsBusy = false;
    }
}
/** Does Kick tell this server when a bell channel goes live? (the 2-minute look can then be slow) */
const pushesLive = () => enabled() && statusSubs.size > 0;

// ------------------------------------------------------------------------------------------ rooms and delivery

function room(slug) {
    let r = rooms.get(slug);
    if (!r) { r = { slug, userId: null, messages: [], serial: 0, viewers: new Map(), sub: '', subBusy: null, linger: null }; rooms.set(slug, r); }
    return r;
}

function plan() {
    const any = [...rooms.values()].some((r) => r.viewers.size);
    if (any && !batchTimer) {
        batchTimer = setInterval(flush, BATCH_MS);
        if (batchTimer.unref) batchTimer.unref();
    } else if (!any && batchTimer) {
        clearInterval(batchTimer);
        batchTimer = null;
    }
}

function flush() {
    rooms.forEach((r) => {
        r.viewers.forEach((v, key) => {
            if (v.sent >= r.serial) return;
            const fresh = r.messages.filter((m) => m.n > v.sent);
            const skipped = Math.max(0, r.serial - v.sent - fresh.length) + Math.max(0, fresh.length - BATCH_MAX);
            v.sent = r.serial;
            try { v.sink({ slug: r.slug, messages: fresh.slice(-BATCH_MAX), skipped }); } catch (_e) { leave(r.slug, key); }
        });
    });
}

const clean = (m) => ({ id: m.id, at: m.at, name: m.name, color: m.color, badges: m.badges, text: m.text });

/**
 * A chat panel opened: `sink(batch)` gets { slug, messages[], skipped } from now on (key: the viewer, its socket).
 * Answers what is held already. The first viewer of a channel makes the subscription at Kick.
 */
async function watch(slug, key, sink) {
    if (!enabled()) throw new ChatError('Chat is switched off (Channels > Kick > Chat).', 'KICK_CHAT_OFF');
    const c = deps.channel(slug);
    if (!c) throw new ChatError('That channel is not on the list', 'KICK_NOT_LISTED');
    if (!c.userId) throw new ChatError('Kick did not say who that channel is; remove it and add it again.', 'KICK_NO_USER');
    const r = room(c.slug);
    r.userId = c.userId;
    clearTimeout(r.linger);
    r.linger = null;
    if (!r.sub) {
        if (!r.subBusy) r.subBusy = subscribe(c.userId, 'chat.message.sent').then((id) => { r.sub = id; }).finally(() => { r.subBusy = null; });
        try { await r.subBusy; } catch (e) { if (!r.viewers.size) rooms.delete(r.slug); throw e; }
    }
    r.viewers.set(key, { sink, sent: r.serial });
    plan();
    return { slug: r.slug, messages: r.messages.slice(-BACKLOG).map(clean), canSend: linked() };
}

/** A chat panel closed (or its socket did). The channel's subscription goes a minute after its last viewer. */
function leave(slug, key) {
    const list = slug ? [rooms.get(slug)].filter(Boolean) : [...rooms.values()];
    list.forEach((r) => {
        if (!r.viewers.delete(key) || r.viewers.size || r.linger) return;
        r.linger = setTimeout(() => {
            r.linger = null;
            if (r.viewers.size) return;
            rooms.delete(r.slug);
            unsubscribe([r.sub]);
        }, LINGER_MS);
        if (r.linger.unref) r.linger.unref();
    });
    plan();
}

function takeMessage(d) {
    const slug = String((d.broadcaster && d.broadcaster.channel_slug) || '').toLowerCase();
    const r = rooms.get(slug) || [...rooms.values()].find((x) => x.userId && d.broadcaster && Number(x.userId) === Number(d.broadcaster.user_id));
    if (!r) return;
    const sender = d.sender || {};
    const ident = sender.identity || {};
    const color = /^#[0-9a-fA-F]{6}$/.test(String(ident.username_color || '')) ? String(ident.username_color) : '';
    r.serial += 1;
    r.messages.push({
        n: r.serial, id: String(d.message_id || r.serial).slice(0, 64), at: Date.parse(d.created_at) || Date.now(),
        name: String(sender.username || '').slice(0, 40), color,
        badges: (Array.isArray(ident.badges) ? ident.badges : []).map((b) => String((b && b.type) || '').slice(0, 20)).filter(Boolean).slice(0, 4),
        text: String(d.content || '').slice(0, MAX_TEXT + 200)
    });
    if (r.messages.length > KEEP) r.messages.splice(0, r.messages.length - KEEP);
}

/** One delivery from Kick, already verified. */
function takeEvent(type, d) {
    if (!d || typeof d !== 'object') return;
    if (type === 'chat.message.sent') takeMessage(d);
    else if (type === 'livestream.status.updated') { try { deps.look(); } catch (_e) { /* the slow look finds it */ } }
}

// ------------------------------------------------------------------------------------------ the account (sending)

function linkStart() {
    const key = deps.key();
    const o = origin();
    if (!key) throw new ChatError('Kick needs its key first (Service keys > Kick).', 'KICK_NO_KEY');
    if (!o) throw new ChatError('The server does not know its public address.', 'KICK_NO_ORIGIN');
    const now = Date.now();
    linking.forEach((v, k) => { if (v.until < now) linking.delete(k); });
    const st = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const redirect = `${o}${OAUTH_PATH}`;
    linking.set(st, { verifier, redirect, until: now + 10 * MIN });
    const q = new URLSearchParams({ client_id: key.clientId, response_type: 'code', redirect_uri: redirect, scope: 'chat:write', state: st, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return { url: `${KICK_ID}/oauth/authorize?${q.toString()}`, redirectUrl: redirect };
}

/** Is this a sign-in answer this server is waiting for? (the gate lets only those through) */
const linkPending = (st) => { const v = linking.get(String(st || '')); return !!v && v.until > Date.now(); };

async function linkFinish(st, code) {
    const v = linking.get(String(st || ''));
    linking.delete(String(st || ''));
    const key = deps.key();
    if (!v || v.until < Date.now() || !code || !key) throw new ChatError('That sign-in is no longer waiting. Start it again from Videos.', 'KICK_LINK_GONE');
    const r = await call('POST', `${KICK_ID}/oauth/token`, { form: { grant_type: 'authorization_code', code: String(code), client_id: key.clientId, client_secret: key.secret, redirect_uri: v.redirect, code_verifier: v.verifier } });
    const j = r.body || {};
    if (r.status !== 200 || !j.access_token || !j.refresh_token) throw new ChatError('Kick did not finish the sign-in', 'KICK_LINK_REFUSED');
    load().user = { access: j.access_token, refresh: j.refresh_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000, scope: String(j.scope || '') };
    save();
    if (onChanged) onChanged();
    return true;
}

async function unlink() {
    const s = load();
    const u = s.user;
    s.user = null;
    save();
    if (u && u.refresh) { try { await call('POST', `${KICK_ID}/oauth/revoke?${new URLSearchParams({ token: u.refresh, token_hint_type: 'refresh_token' }).toString()}`); } catch (_e) { /* forgotten here all the same */ } }
    if (onChanged) onChanged();
    return status();
}

let refreshing = null;
async function userToken() {
    const s = load();
    if (!s.user) throw new ChatError('Link a Kick account first (Channels > Kick > Chat).', 'KICK_NOT_LINKED');
    if (s.user.access && Date.now() < s.user.until - MIN) return s.user.access;
    if (!refreshing) {
        refreshing = (async () => {
            const key = deps.key();
            if (!key) throw new ChatError('Kick needs its key first (Service keys > Kick).', 'KICK_NO_KEY');
            const r = await call('POST', `${KICK_ID}/oauth/token`, { form: { grant_type: 'refresh_token', refresh_token: s.user.refresh, client_id: key.clientId, client_secret: key.secret } });
            const j = r.body || {};
            if (r.status === 400 || r.status === 401) { s.user = null; save(); if (onChanged) onChanged(); throw new ChatError('Kick wants the account linked again (Channels > Kick > Chat).', 'KICK_NOT_LINKED'); }
            if (r.status !== 200 || !j.access_token) throw new ChatError(`Kick answered ${r.status}`, 'KICK_REFUSED');
            s.user = { access: j.access_token, refresh: j.refresh_token || s.user.refresh, until: Date.now() + (Number(j.expires_in) || 3600) * 1000, scope: String(j.scope || s.user.scope || '') };
            save();
            return s.user.access;
        })().finally(() => { refreshing = null; });
    }
    return refreshing;
}

/** Says something in a listed channel's chat as the linked account. */
async function say(slug, text) {
    const c = deps.channel(slug);
    if (!c || !c.userId) throw new ChatError('That channel is not on the list', 'KICK_NOT_LISTED');
    const content = String(text || '').replace(/\s+/g, ' ').trim();
    if (!content) throw new ChatError('There is nothing to send', 'KICK_EMPTY');
    if ([...content].length > MAX_TEXT || Buffer.byteLength(content) > 2048) throw new ChatError(`A message holds ${MAX_TEXT} characters`, 'KICK_TOO_LONG');
    const token = await userToken();
    const r = await call('POST', `${KICK}/chat`, { token, json: { broadcaster_user_id: Number(c.userId), content, type: 'user' } });
    if (r.status === 401) { load().user.until = 0; throw new ChatError('Kick did not take the message; try again.', 'KICK_REFUSED'); }
    if (r.status === 403) throw new ChatError('Kick does not let this account write in that chat (followers or subscribers only, or a ban).', 'KICK_FORBIDDEN');
    if (r.status === 429) throw new ChatError('Too fast for Kick; wait a moment.', 'KICK_SLOW');
    if (r.status !== 200 || !(r.body && r.body.data && r.body.data.is_sent)) throw new ChatError(`Kick answered ${r.status}`, 'KICK_REFUSED');
    return { sent: true, id: String(r.body.data.message_id || '') };
}

async function setEnabled(on) {
    const s = load();
    s.enabled = !!on;
    save();
    if (!s.enabled) {
        const ids = [...rooms.values()].map((r) => r.sub).concat([...statusSubs.values()]);
        rooms.forEach((r) => clearTimeout(r.linger));
        rooms.clear();
        statusSubs = new Map();
        plan();
        await unsubscribe(ids);
    } else {
        syncBells();
    }
    if (onChanged) onChanged();
    return status();
}

// ------------------------------------------------------------------------------------------ emote pictures

function imageType(buf) {
    if (!buf || buf.length < 12) return '';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    return '';
}

const emoteBusy = new Map();
/** An emote's picture as a file on disk (fetched from Kick's public files once): { file, type } or null. */
function emote(id) {
    if (!EMOTE_ID.test(String(id))) return Promise.resolve(null);
    const file = path.join(EMOTE_DIR, String(id));
    const typeFile = `${file}.type`;
    try { if (fs.statSync(file).size > 0) return Promise.resolve({ file, type: fs.readFileSync(typeFile, 'utf8').trim() || 'image/webp' }); } catch (_e) { /* not held yet */ }
    if (emoteBusy.has(id)) return emoteBusy.get(id);
    const job = (async () => {
        try {
            const res = await deps.fetch(`${EMOTE_BASE}/${id}/fullsize`, { signal: AbortSignal.timeout(10000) });
            if (res.status !== 200) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            // Kick's files say "binary/octet-stream": the picture's kind is read from its first bytes
            const type = imageType(buf);
            if (!type || buf.length > 2 * 1024 * 1024) return null;
            fs.mkdirSync(EMOTE_DIR, { recursive: true });
            fs.writeFileSync(typeFile, type);
            fs.writeFileSync(`${file}.tmp`, buf);
            fs.renameSync(`${file}.tmp`, file);
            return { file, type };
        } catch (_e) {
            return null;
        } finally {
            emoteBusy.delete(id);
        }
    })();
    emoteBusy.set(id, job);
    return job;
}

// ------------------------------------------------------------------------------------------ routes

/** Should the site gate let this request through without a session? Only Kick's webhook while chat is on, and a sign-in answer that is awaited. */
function gateExempt(method, p, query) {
    if (method === 'POST' && p === WEBHOOK_PATH) return enabled();
    if (method === 'GET' && p === OAUTH_PATH) return linkPending(query && query.state);
    return false;
}

const page = (title, text) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px sans-serif;margin:2em"><h3>${title}</h3><p>${text}</p>`;

/**
 * mountRaw runs before the JSON body parser: the webhook's signature is over the exact bytes Kick sent.
 * notFound(res): the answer for anything that is not Kick's (the cover's own 404).
 */
function mountRaw(app, express, notFound) {
    app.post(WEBHOOK_PATH, express.raw({ type: () => true, limit: '256kb' }), async (req, res) => {
        const raw = Buffer.isBuffer(req.body) ? req.body : null;
        const id = String(req.get('Kick-Event-Message-Id') || '');
        if (!enabled() || !raw || !(await verify(id, String(req.get('Kick-Event-Message-Timestamp') || ''), raw, String(req.get('Kick-Event-Signature') || '')))) { notFound(res); return; }
        res.status(200).end();
        if (seenIds.has(id)) return;
        seenIds.add(id);
        seenOrder.push(id);
        if (seenOrder.length > 2000) seenIds.delete(seenOrder.shift());
        let d = null;
        try { d = JSON.parse(raw.toString('utf8')); } catch (_e) { d = null; }
        takeEvent(String(req.get('Kick-Event-Type') || ''), d);
    });
}

function mount(app, authMiddleware, notFound) {
    app.get(OAUTH_PATH, async (req, res) => {
        if (!linkPending(req.query.state)) { notFound(res); return; }
        res.set('Cache-Control', 'no-store');
        if (req.query.error || !req.query.code) { linking.delete(String(req.query.state)); res.status(200).send(page('Kick was not linked', 'The sign-in was cancelled. You can close this page.')); return; }
        try {
            await linkFinish(req.query.state, req.query.code);
            res.status(200).send(page('Kick is linked', 'Melaton Videos can now send chat messages as this account. You can close this page.'));
        } catch (e) {
            res.status(200).send(page('Kick was not linked', `${String(e.message).replace(/[<>&]/g, '')} You can close this page.`));
        }
    });
    app.get(`${EMOTE_PATH}/:id`, authMiddleware, async (req, res) => {
        const e = await emote(req.params.id);
        if (!e) { res.status(404).end(); return; }
        res.set({ 'Content-Type': e.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        res.sendFile(path.basename(e.file), { root: path.dirname(e.file), dotfiles: 'allow' });
    });
}

module.exports = {
    bind, status, enabled, setEnabled, watch, leave, say, linkStart, unlink, gateExempt, mountRaw, mount, syncBells, tidy, pushesLive, ChatError,
    onChanged(fn) { onChanged = typeof fn === 'function' ? fn : null; },
    WEBHOOK_PATH, OAUTH_PATH, EMOTE_PATH,
    _test: {
        verify, takeEvent, flush, rooms, linkFinish, linkPending, emote,
        setKey(pem) { publicKey = { pem, at: Date.now() }; },
        reset() { state = null; rooms.forEach((r) => clearTimeout(r.linger)); rooms.clear(); seenIds.clear(); seenOrder.length = 0; publicKey = { pem: '', at: 0 }; clearInterval(batchTimer); batchTimer = null; linking.clear(); statusSubs = new Map(); refreshing = null; }
    }
};
