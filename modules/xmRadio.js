'use strict';
/**
 * XM Radio (Yozora #989): the server half of the skeuomorphic SiriusXM radio on the desktop and the phone.
 *
 * The server is one SiriusXM "device" (the web player's own API, captured Nov 20 2026; memory siriusxm-api):
 *   device     POST /device/v2/devices -> a device grant (30 d) and refresh grant (6 mo), refreshed with
 *              POST /device/v2/grant/refresh { refreshGrant }; no client secret
 *   anonymous  POST /session/v1/sessions/anonymous (Bearer grant) -> a 3 h access token (sign-in, now playing)
 *   sign-in    GET /identity/v1/identities/status?handle -> how the account signs in; POST
 *              /identity/v1/identities/authenticate/password { handle, password } -> an identity grant; POST
 *              /session/v1/sessions/authenticated (Bearer that grant) -> the account's access token. The password is
 *              used once and never kept (Yukimi, Nov 20 2026: the server keeps the token).
 *   play       POST /playback/play/v1/tuneSource -> the channel's HLS stream (signed CDN addresses); its AES key from
 *              GET /playback/key/v1/<id> needs the token. The radios play our copy of the playlist
 *              (/api/xmradio/live/<sid>/...): every address in it comes back through the server, the key line too, so
 *              the token never leaves the server and no player needs SiriusXM's CORS.
 *   on now     public lookAround (every channel's current cut) read by the `xmradio` status feed while a radio
 *              is on; pushed per channel, only what changed (rule server-push-not-polling)
 *
 * Files: <cache>/xmradio-account.json (0600): the device and identity grants, the handle (masked for clients).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = 'https://api.edge-gateway.siriusxm.com';
const LOOKAROUND = 'https://lookaround-cache-prod.streaming.siriusxm.com/playbackservices/v1/live/lookAround';
const APP_VERSION = '7.143.0';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;
const HUB_INTERVAL = 20000;
const STREAM_IDLE_MS = 30 * 60 * 1000;
const STREAM_HOSTS = /\.streaming\.siriusxm\.com$/i;

let gr = null;
let state = null; // the account file
let anon = null; // { token, exp }
let auth = null; // { token, exp, entitlementHash }
let clock = 0;
let hub = null;
const streams = new Map(); // sid -> { sid, channelId, url, keyBase, used }
const nowPlaying = new Map(); // channelId -> { a, t, s, ad, at }
let lookDelta = '';
let lookAt = 0;

function bind(globalResources) {
    if (!gr) gr = globalResources;
    return module.exports;
}

function accountFile() {
    const base = process.env.XMRADIO_ACCOUNT_FILE || path.join((gr && gr.getPath ? gr.getPath('cache') : path.resolve(__dirname, '../.cache')), 'xmradio-account.json');
    return base;
}

function load() {
    if (state) return state;
    try { state = JSON.parse(fs.readFileSync(accountFile(), 'utf8')) || {}; } catch (_) { state = {}; }
    return state;
}

function save() {
    const f = accountFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, f);
}

function fail(message, code, extra) {
    const e = new Error(message);
    e.code = code || 'XMRADIO_ERROR';
    if (extra) Object.assign(e, extra);
    return e;
}

/** A JWT's expiry (ms), 0 when it cannot be read. */
function jwtExp(token) {
    try {
        const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
        return p && p.exp ? p.exp * 1000 : 0;
    } catch (_) { return 0; }
}

async function api(method, p, { bearer, body, query } = {}) {
    const url = new URL(API + p);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers = {
        Accept: 'application/json',
        'User-Agent': UA,
        Origin: 'https://www.siriusxm.com',
        Referer: 'https://www.siriusxm.com/',
        'x-sxm-clock': JSON.stringify([0, ++clock])
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    let res;
    try {
        res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
        throw fail('SiriusXM could not be reached.', 'XMRADIO_OFFLINE');
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    return { status: res.status, json, text };
}

// ------------------------------------------------------------------ the device and its sessions

async function ensureDevice() {
    const s = load();
    const now = Date.now();
    if (!s.grant || !s.refreshGrant || (s.refreshGrantExpiresAt && Date.parse(s.refreshGrantExpiresAt) < now + 60000)) {
        const r = await api('POST', '/device/v2/devices', {
            body: { devicePlatform: 'web-desktop', deviceAttributes: { browser: { app: 'web-player', appVersion: APP_VERSION, userAgent: UA } }, grantVersion: 'v2', tenant: 'sxm' }
        });
        if (!r.json || !r.json.grant) throw fail('SiriusXM did not register this radio.', 'XMRADIO_DEVICE', { status: r.status });
        Object.assign(s, pick(r.json, ['deviceId', 'grant', 'grantExpiresAt', 'refreshGrant', 'refreshGrantExpiresAt']));
        // a new device knows no account
        delete s.identityId;
        delete s.identityGrant;
        anon = null;
        auth = null;
        save();
    } else if (s.grantExpiresAt && Date.parse(s.grantExpiresAt) < now + 24 * 3600 * 1000) {
        const r = await api('POST', '/device/v2/grant/refresh', { bearer: s.grant, body: { refreshGrant: s.refreshGrant } });
        if (r.json && r.json.grant) {
            Object.assign(s, pick(r.json, ['deviceId', 'grant', 'grantExpiresAt', 'refreshGrant', 'refreshGrantExpiresAt']));
            save();
        }
    }
    return s;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

async function anonToken() {
    if (anon && anon.exp > Date.now() + 60000) return anon.token;
    const s = await ensureDevice();
    const r = await api('POST', '/session/v1/sessions/anonymous', { bearer: s.grant, body: {} });
    if (!r.json || !r.json.accessToken) throw fail('SiriusXM did not open a session.', 'XMRADIO_SESSION', { status: r.status });
    anon = { token: r.json.accessToken, exp: Date.parse(r.json.accessTokenExpiresAt) || Date.now() + 3600000 };
    return anon.token;
}

/** The account's access token; null when nobody is signed in (or SiriusXM ended the sign-in). */
async function authToken() {
    if (auth && auth.exp > Date.now() + 60000) return auth.token;
    const s = await ensureDevice();
    if (!s.identityId || s.signedOut) {
        // the CardSpace card signs in again by itself (never after Sign Out, at most every 10 minutes)
        if (s.manualSignOut || !card() || Date.now() - cardTriedAt < RETRY_MS) return null;
        cardTriedAt = Date.now();
        try { await signInWithCard(); } catch (_) { return null; }
        return auth ? auth.token : null;
    }
    // the identity grant from the sign-in, else the device grant (signed in, the device carries the identity)
    for (const bearer of [s.identityGrant, s.grant].filter(Boolean)) {
        const r = await api('POST', '/session/v1/sessions/authenticated', { bearer });
        if (r.json && r.json.accessToken) {
            auth = { token: r.json.accessToken, exp: Date.parse(r.json.accessTokenExpiresAt) || Date.now() + 3600000, entitlementHash: r.json.entitlementHash || '' };
            if (s.signedOut) { delete s.signedOut; save(); }
            return auth.token;
        }
    }
    s.signedOut = 'expired';
    save();
    touch();
    return null;
}

// ------------------------------------------------------------------ sign-in

const maskHandle = (h) => {
    const v = String(h || '');
    const at = v.indexOf('@');
    if (at > 1) return `${v[0]}${'•'.repeat(Math.min(6, at - 1))}${v.slice(at)}`;
    return v.length > 2 ? `${v.slice(0, 2)}${'•'.repeat(Math.min(6, v.length - 2))}` : v;
};

function account() {
    const s = load();
    return {
        signedIn: !!s.identityId && !s.signedOut,
        expired: s.signedOut === 'expired',
        handle: s.identityId ? maskHandle(s.handle) : '',
        since: s.signedInAt || null,
        browserSignIn: signInPageState(),
        card: !!card(),
        cardRefused: !!(s.refusedCard && card() && s.refusedCard === cardPrint(card()))
    };
}

/** How an account signs in (password, passkey, a code to its contacts). */
async function signInStatus(handle) {
    const h = String(handle || '').trim();
    if (!h || h.length > 200) throw fail('Type the email or username of your SiriusXM account.', 'XMRADIO_HANDLE');
    const r = await api('GET', '/identity/v1/identities/status', { bearer: await anonToken(), query: { handle: h } });
    if (r.status === 404) throw fail('SiriusXM does not know that email or username.', 'XMRADIO_NO_ACCOUNT');
    if (!r.json || !r.json.identityId) throw fail('SiriusXM could not look up the account.', 'XMRADIO_STATUS', { status: r.status });
    return { hasPassword: !!r.json.hasPassword, hasPasskey: !!r.json.hasPasskey, contacts: (r.json.contactOptions || []).map((c) => ({ type: c.type, masked: c.maskedValue })) };
}

async function signInPassword(handle, password) {
    const h = String(handle || '').trim();
    const pw = String(password || '');
    if (!h || !pw) throw fail('Type your email or username and your password.', 'XMRADIO_HANDLE');
    const s = await ensureDevice();
    // the anonymous session's token carries the call, as on the web player
    let r = await api('POST', '/identity/v1/identities/authenticate/password', { bearer: await anonToken(), body: { handle: h, password: pw } });
    if ((r.status === 401 || r.status === 403) && !(r.json && r.json.grant)) {
        r = await api('POST', '/identity/v1/identities/authenticate/password', { bearer: s.grant, body: { handle: h, password: pw } });
    }
    if (!r.json || !r.json.grant) {
        const why = r.json && (r.json.description || r.json.message);
        console.warn(`[xmRadio] password sign-in refused: ${r.status} ${(r.json && r.json.code) || ''}`);
        throw fail(r.status === 401 || r.status === 400 ? 'The email, username or password is not right.' : `SiriusXM could not sign you in${why ? `: ${why}` : '.'}`, 'XMRADIO_SIGNIN', { status: r.status });
    }
    s.identityId = r.json.identityId;
    s.identityGrant = r.json.grant;
    s.handle = h;
    s.signedInAt = Date.now();
    delete s.signedOut;
    auth = null;
    save();
    const tok = await authToken();
    if (!tok) {
        delete s.identityId;
        delete s.identityGrant;
        save();
        throw fail('SiriusXM signed you in but did not open a session.', 'XMRADIO_SESSION');
    }
    touch();
    return account();
}

// ------------------------------------------------------------------ the sign-in page (in Alchemy, where 1Password is)

/*
 * Yukimi (Nov 20 2026): 1Password lives in the server's Alchemy browser, and what is copied there cannot be pasted
 * into the Melaton page. So the radio's Sign In opens a small sign-in page of our own in Alchemy, at a one-time
 * address on this server's loopback port (/xmradio-signin/<code>, 10 minutes, five tries, mounted ahead of the site
 * gate: any other code answers 404). 1Password fills it there; the server signs in with its own SiriusXM device as
 * signInPassword does (the password goes to SiriusXM once and is never kept), and the account item is pushed.
 */
const SIGNIN_PAGE_MS = 10 * 60 * 1000;
let signInPage = null; // { code, until, tries, done }

function signInPageState() {
    const p = signInPage;
    return p && !p.done && p.until > Date.now() ? { waiting: true, until: p.until } : null;
}

/** A one-time sign-in page address for Alchemy. */
function signInPageStart() {
    const code = crypto.randomBytes(24).toString('hex');
    signInPage = { code, until: Date.now() + SIGNIN_PAGE_MS, tries: 0, done: false };
    const port = Number((gr && gr.getConfig && gr.getConfig({ path: 'port' })) || process.env.PORT || 9220);
    touch();
    return { url: `http://127.0.0.1:${port}/xmradio-signin/${code}` };
}

function signInPageCancel() {
    signInPage = null;
    touch();
    return account();
}

const pageOk = (code) => {
    const p = signInPage;
    return !!(p && !p.done && p.until > Date.now() && typeof code === 'string' && code.length === p.code.length
        && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(p.code)));
};

const PAGE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Sign in to SiriusXM - XM Radio</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1d1f23;font:14px/1.4 "Segoe UI",Tahoma,sans-serif;color:#e9edf2}
form{width:320px;padding:26px 28px;border-radius:14px;background:linear-gradient(#3b3f45,#26292e);box-shadow:0 8px 24px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.18)}
h1{margin:0 0 4px;font-size:18px}h1 b{font-style:italic;padding:0 4px;border-radius:3px;background:linear-gradient(#2f8ff0,#145fbd)}
p{margin:0 0 16px;color:#b9c0c9;font-size:12.5px}
label{display:block;margin:0 0 12px;font-size:12.5px;color:#c9ced6}
input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px 10px;border:1px solid #16181b;border-radius:6px;background:#111316;color:#fff;font:inherit}
button{width:100%;padding:9px;border:1px solid #0d4a9b;border-radius:6px;background:linear-gradient(#2f8ff0,#145fbd);color:#fff;font:600 14px "Segoe UI",Tahoma,sans-serif;cursor:pointer}
button:disabled{opacity:.6}.msg{min-height:18px;margin:10px 0 0;font-size:12.5px}.bad{color:#ff9b8f}.good{color:#8dff9f}
</style></head><body>
<form id="f" autocomplete="on"><h1><b>XM</b> Radio</h1><p>Sign in with your SiriusXM account. The login is kept in Dreamscape CardSpace, so XM Radio can sign in again by itself.</p>
<label>Email or username<input name="username" id="username" type="text" autocomplete="username" required autofocus></label>
<label>Password<input name="password" id="password" type="password" autocomplete="current-password" required></label>
<button id="go" type="submit">Sign In</button><div class="msg" id="msg" role="status"></div></form>
<script>
const f=document.getElementById('f'),msg=document.getElementById('msg'),go=document.getElementById('go');
f.addEventListener('submit',async(e)=>{e.preventDefault();go.disabled=true;msg.className='msg';msg.textContent='Signing in...';
try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:f.username.value.trim(),password:f.password.value})});
const j=await r.json().catch(()=>({}));if(r.ok&&j.ok){f.password.value='';msg.className='msg good';msg.textContent='Signed in. XM Radio is ready; you can close this tab.';setTimeout(()=>window.close(),1500);return;}
msg.className='msg bad';msg.textContent=j.error||'SiriusXM could not sign you in.';}catch(_){msg.className='msg bad';msg.textContent='Dreamscape could not be reached.';}
go.disabled=false;});
</script></body></html>`;

/** The page and its answer, mounted ahead of the site gate and the session (web_server.js). */
function mountSignInPage(app, express) {
    const notFound = (res) => res.status(404).type('text/plain').send('Not Found');
    app.get('/xmradio-signin/:code', (req, res) => {
        if (!pageOk(String(req.params.code))) { notFound(res); return; }
        res.set('Cache-Control', 'no-store');
        res.set('X-Frame-Options', 'DENY');
        res.type('html').send(PAGE_HTML);
    });
    app.post('/xmradio-signin/:code', express.json({ limit: '4kb' }), async (req, res) => {
        if (!pageOk(String(req.params.code))) { notFound(res); return; }
        const p = signInPage;
        p.tries += 1;
        if (p.tries > 5) { signInPage = null; touch(); notFound(res); return; }
        const b = req.body || {};
        try {
            await signInPassword(b.handle, b.password);
            // kept in CardSpace with the rest (Yukimi, Nov 20 2026), so the radio can sign in again by itself
            try { saveCard(String(b.handle).trim(), String(b.password)); } catch (err) { console.warn(`[xmRadio] CardSpace card not saved: ${err.message}`); }
            const st = load();
            delete st.refusedCard;
            delete st.manualSignOut;
            save();
            p.done = true;
            touch();
            res.set('Cache-Control', 'no-store').json({ ok: true });
        } catch (err) {
            res.status(400).set('Cache-Control', 'no-store').json({ ok: false, error: (err && err.message) || 'SiriusXM could not sign you in.' });
        }
    });
}

// ------------------------------------------------------------------ the CardSpace card

/*
 * Yukimi (Nov 20 2026): "we could store the login with the rest in cardspace". The SiriusXM account is a CardSpace
 * card (apiKeyManager service `siriusxm`: the password as the key, the email or username as a field), and the server
 * signs in with it on its own device, again by itself whenever SiriusXM ends the session. A refused password is not
 * tried again until the card changes.
 */
const RETRY_MS = 10 * 60 * 1000;
let cardTriedAt = 0;

function card() {
    try {
        const m = gr && gr.getApiKeyManager && gr.getApiKeyManager();
        if (!m) return null;
        const k = m.getServiceKeys('siriusxm')[m.getSelectedIndex('siriusxm')];
        return k && k.apiKey && k.username ? { handle: String(k.username), password: String(k.apiKey), name: k.name } : null;
    } catch (_) { return null; }
}

const cardPrint = (c) => (c ? crypto.createHash('sha256').update(`${c.handle}\n${c.password}`).digest('hex').slice(0, 16) : '');

/** Sign in with the CardSpace card (the radio's Sign In, and on its own when the session ended). */
async function signInWithCard({ force } = {}) {
    const c = card();
    if (!c) throw fail('There is no SiriusXM card in CardSpace yet.', 'XMRADIO_NO_CARD');
    const s = load();
    if (!force && s.refusedCard && s.refusedCard === cardPrint(c)) throw fail('SiriusXM refused the password on the CardSpace card. Edit the card, then sign in again.', 'XMRADIO_SIGNIN');
    try {
        const out = await signInPassword(c.handle, c.password);
        delete s.refusedCard;
        delete s.manualSignOut;
        save();
        return out;
    } catch (err) {
        if (err && err.code === 'XMRADIO_SIGNIN' && (err.status === 400 || err.status === 401)) { s.refusedCard = cardPrint(c); save(); touch(); }
        throw err;
    }
}

/** The card the sign-in page made, kept in CardSpace (added, or the same account's card updated). */
function saveCard(handle, password) {
    const m = gr && gr.getApiKeyManager && gr.getApiKeyManager();
    if (!m) return false;
    const keys = m.getServiceKeys('siriusxm');
    const i = keys.findIndex((k) => String(k.username || '').toLowerCase() === String(handle).toLowerCase());
    if (i >= 0) m.updateApiKey('siriusxm', i, keys[i].name, password, { fields: { username: handle } });
    else m.addApiKey('siriusxm', 'SiriusXM', password, { fields: { username: handle } });
    return true;
}

function signOut() {
    const s = load();
    delete s.identityId;
    delete s.identityGrant;
    delete s.handle;
    delete s.signedInAt;
    delete s.signedOut;
    // the card stays in CardSpace; the radio does not sign in with it again until Sign In is chosen
    s.manualSignOut = true;
    auth = null;
    save();
    for (const sid of [...streams.keys()]) streams.delete(sid);
    touch();
    return account();
}

// ------------------------------------------------------------------ the lineup and what is on

/** The public lookAround: every channel's current cut and show (a delta after the first read). */
async function readLookAround() {
    const url = `${LOOKAROUND}?delta=${encodeURIComponent(lookDelta)}`;
    let j;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        j = await res.json();
    } catch (_) { return false; }
    if (!j || !j.channels) return false;
    const now = Date.now();
    for (const [id, c] of Object.entries(j.channels)) {
        const cuts = (c.cuts || []).filter((x) => Date.parse(x.validFrom) <= now).sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
        const shows = (c.shows || []).filter((x) => Date.parse(x.validFrom) <= now).sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
        const cut = cuts[0];
        const show = shows[0];
        if (!cut && !show) continue;
        const art = (cut && cut.image && cut.image.url) || (show && show.image && show.image.url) || '';
        nowPlaying.set(id, { a: cut ? String(cut.artistName || '') : '', t: cut ? String(cut.name || '') : '', ad: !!(cut && cut.isAd), s: show ? String(show.name || '') : '', i: art ? artPath(art, 300) : '', at: cut ? Date.parse(cut.validFrom) : now });
    }
    if (j.delta) lookDelta = j.delta;
    lookAt = now;
    return true;
}

/** The status feed: the account, and each channel's current cut (pushed only when it changed). */
function defineFeed(statusHub) {
    if (hub || !statusHub) return hub;
    hub = statusHub.define({
        name: 'xmradio',
        pushType: 'xmradio_status',
        intervalMs: HUB_INTERVAL,
        allow: (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || ''))),
        sample: async () => {
            await readLookAround();
            const items = { account: account(), lineup: lineupCache && lineupCache.at ? { at: lineupCache.at, n: lineupCache.channels.length } : null };
            for (const [id, v] of nowPlaying) items[`ch:${id}`] = { a: v.a, t: v.t, s: v.s, ad: v.ad, i: v.i };
            return items;
        }
    });
    return hub;
}

function touch() {
    if (hub && typeof hub.poke === 'function') hub.poke();
}

// ------------------------------------------------------------------ the lineup and presets

// the lineup changes rarely: read again after a month, or when the radio's MENU > Refresh Lineup asks (Yukimi, Nov 20 2026)
const LINEUP_TTL = 30 * 24 * 3600 * 1000;
let lineupCache = null; // { at, channels }
let lineupBuilding = null;

function lineupFile() { return path.join(path.dirname(accountFile()), 'xmradio-lineup.json'); }

/**
 * A channel's number and name: liveUpdate answers them for every channel (the guide's peek only carries songs; checked
 * Nov 20 2026). About 78 KB a channel, so the lineup is read a few at a time, once a month.
 */
async function channelInfo(id, tok) {
    const now = new Date().toISOString();
    const r = await api('POST', '/playback/play/v1/liveUpdate', { bearer: tok, body: { channelId: id, startTimestamp: now, endTimestamp: now } });
    const j = r.json;
    const number = j && Number(j.channelNumber || j.channelNumberCanonical);
    if (!number) return null;
    return { id, number, name: String(j.channelName || ''), type: String(j.type || 'channel-linear') };
}

/** The channels this account can tune, by number (kept a month; built again on demand). */
async function lineup({ fresh } = {}) {
    if (!lineupCache) { try { lineupCache = JSON.parse(fs.readFileSync(lineupFile(), 'utf8')); } catch (_) { lineupCache = null; } }
    if (!fresh && lineupCache && lineupCache.channels && lineupCache.channels.length && Date.now() - lineupCache.at < LINEUP_TTL) return withPlan(lineupCache.channels);
    if (lineupBuilding) return lineupBuilding;
    lineupBuilding = (async () => {
        const tok = await authToken();
        if (!tok) throw fail('Sign in to SiriusXM to see the channels.', 'XMRADIO_SIGNED_OUT');
        if (!nowPlaying.size) await readLookAround();
        const ids = [...nowPlaying.keys()];
        const out = [];
        let i = 0;
        // a few at a time: the guide is read once a week
        await Promise.all(Array.from({ length: 10 }, async () => {
            while (i < ids.length) {
                const id = ids[i++];
                try { const c = await channelInfo(id, tok); if (c) out.push(c); } catch (_) { /* skipped */ }
            }
        }));
        out.sort((a, b) => a.number - b.number || a.name.localeCompare(b.name));
        if (out.length) {
            lineupCache = { at: Date.now(), channels: out, notInPlan: (lineupCache && lineupCache.notInPlan) || [], logos: (lineupCache && lineupCache.logos) || {} };
            try { fs.writeFileSync(lineupFile(), JSON.stringify(lineupCache), { mode: 0o600 }); } catch (_) { /* kept in memory */ }
            // a radio that gave up waiting reads it when this is pushed
            touch();
        }
        return withPlan(out);
    })().finally(() => { lineupBuilding = null; });
    return lineupBuilding;
}

/** Channels outside the account's plan (a tune answered not-entitled) carry sub: false; the radio skips them. */
function withPlan(list) {
    const no = new Set((lineupCache && lineupCache.notInPlan) || []);
    const logos = (lineupCache && lineupCache.logos) || {};
    return list.map((c) => {
        const out = Object.assign({}, c);
        if (no.has(c.id)) out.sub = false;
        if (logos[c.id]) out.logo = artPath(logos[c.id], 240);
        return out;
    });
}

function saveLineup() {
    try { fs.writeFileSync(lineupFile(), JSON.stringify(lineupCache), { mode: 0o600 }); } catch (_) { /* kept in memory */ }
}

/**
 * Channel logos (the presets, the display, the guide's rows): from each channel's page (browse/v1/pages/channel-linear,
 * a big page), so only for the channels asked, a few at a time, and kept with the lineup. -> { channelId: artPath }
 */
async function logos(ids) {
    if (!lineupCache) await lineup().catch(() => null);
    if (!lineupCache) return {};
    const want = [...new Set((ids || []).map(String))].filter((id) => /^[0-9a-f-]{20,64}$/i.test(id)).slice(0, 60);
    lineupCache.logos = lineupCache.logos || {};
    const missing = want.filter((id) => !(id in lineupCache.logos));
    if (missing.length) {
        const tok = await authToken();
        if (tok) {
            const eh = (auth && auth.entitlementHash) || '';
            let i = 0;
            let found = 0;
            await Promise.all(Array.from({ length: 4 }, async () => {
                while (i < missing.length) {
                    const id = missing[i++];
                    try {
                        const r = await api('GET', `/browse/v1/pages/channel-linear/${id}`, { bearer: tok, query: { entitlementHash: eh } });
                        const l = r.json && r.json.page && r.json.page.entity && r.json.page.entity.images && r.json.page.entity.images.logo && r.json.page.entity.images.logo.aspect_5x4;
                        const img = l && (l.preferred || l.default || l.preferredImage || l.defaultImage);
                        lineupCache.logos[id] = img && img.url ? String(img.url) : '';
                        found++;
                    } catch (_) { /* asked again next time */ }
                }
            }));
            if (found) saveLineup();
        }
    }
    const out = {};
    for (const id of want) if (lineupCache.logos[id]) out[id] = artPath(lineupCache.logos[id], 240);
    return out;
}

function noteNotInPlan(id) {
    if (!lineupCache) return;
    const set = new Set(lineupCache.notInPlan || []);
    if (set.has(id)) return;
    set.add(id);
    lineupCache.notInPlan = [...set];
    saveLineup();
}

function presets() {
    const p = load().presets || {};
    const out = {};
    for (const b of ['A', 'B', 'C']) out[b] = Array.isArray(p[b]) ? p[b].slice(0, 6).map((x) => (typeof x === 'string' && /^[0-9a-f-]{20,64}$/i.test(x) ? x : null)) : [];
    return out;
}

function setPresets(next) {
    const s = load();
    const clean = {};
    for (const b of ['A', 'B', 'C']) clean[b] = Array.isArray(next && next[b]) ? next[b].slice(0, 6).map((x) => (typeof x === 'string' && /^[0-9a-f-]{20,64}$/i.test(x) ? x : null)) : [];
    s.presets = clean;
    save();
    return presets();
}

// ------------------------------------------------------------------ tuning and the stream

/** tuneSource with the web player's arguments; the reply's stream addresses. */
async function tune(channelId, opts = {}) {
    const id = String(channelId || '');
    if (!/^[0-9a-f-]{20,64}$/i.test(id)) throw fail('No such channel.', 'XMRADIO_CHANNEL');
    const tok = await authToken();
    if (!tok) throw fail('Sign in to SiriusXM to listen.', 'XMRADIO_SIGNED_OUT');
    const body = { id, type: opts.type || 'channel-linear', manifestVariant: opts.manifestVariant || 'WEB', trackResumeSupported: false, hlsVersion: opts.hlsVersion || 'V3', mtcVersion: opts.mtcVersion || 'V2' };
    const r = await api('POST', '/playback/play/v1/tuneSource', { bearer: tok, body });
    if (r.status === 401) { auth = null; throw fail('The SiriusXM sign-in ended. Sign in again.', 'XMRADIO_SIGNED_OUT'); }
    if (r.status === 403 && r.json && /not-entitled/.test(String(r.json.code || ''))) {
        noteNotInPlan(id);
        throw fail('This channel is not in your SiriusXM plan.', 'XMRADIO_NOT_SUBSCRIBED');
    }
    if (!r.json) throw fail('SiriusXM did not tune the channel.', 'XMRADIO_TUNE', { status: r.status, detail: r.text.slice(0, 400) });
    const url = findStreamUrl(r.json);
    if (!url) throw fail('SiriusXM did not give the channel a stream.', 'XMRADIO_TUNE', { status: r.status, detail: JSON.stringify(r.json).slice(0, 600) });
    const sid = crypto.randomBytes(12).toString('hex');
    // the stream's folder on SiriusXM's server is mirrored under /api/xmradio/live/<sid>/m/: the playlists' own relative
    // lines (about 1,850 a variant: five hours of replay) pass through unchanged
    const up = new URL(url);
    const base = new URL('./', up).href;
    streams.set(sid, { sid, channelId: id, url, base, used: Date.now() });
    sweepStreams();
    return { sid, url: `/api/xmradio/live/${sid}/m/${up.href.slice(base.length)}`, channel: describeTune(r.json) };
}

/** The first HLS address anywhere in the tune reply (its exact place is still being learned). */
function findStreamUrl(o) {
    let found = null;
    const walk = (v) => {
        if (found || v == null) return;
        if (typeof v === 'string') {
            if (/^https:\/\/[^/]+\.streaming\.siriusxm\.com\//i.test(v) && !/imgsrv/i.test(v)) found = v;
            return;
        }
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(o);
    return found;
}

const ART_KEY = /^(aem|live|if)\/[A-Za-z0-9_./-]{4,200}$/;
/** Our address for a SiriusXM art key (same origin: the LCD and dot-matrix displays redraw it in a canvas). */
function artPath(key, size = 240) {
    const k = String(key || '');
    return ART_KEY.test(k) ? `/api/xmradio/art?k=${encodeURIComponent(k)}&s=${Math.max(32, Math.min(600, Math.round(size)))}` : '';
}

/** SiriusXM's image service: a relative art key (aem/..., if/...) as a sized JPEG address. */
function imageUrl(key, size = 300) {
    if (!key) return '';
    if (/^https?:/.test(key)) return key;
    const spec = { key, edits: [{ resize: { width: size, height: size } }, { format: { type: 'jpeg' } }] };
    return `https://imgsrv-sxm-prod-device.streaming.siriusxm.com/${Buffer.from(JSON.stringify(spec)).toString('base64')}`;
}

function describeTune(j) {
    const im = (j && j.images) || {};
    const pickImg = (o) => o && (o.preferredImage || o.defaultImage);
    const logo = pickImg(im.logo && im.logo.aspect_5x4) || pickImg(im.tile && im.tile.aspect_1x1);
    if (logo && logo.url && lineupCache) { lineupCache.logos = lineupCache.logos || {}; if (lineupCache.logos[j.id] !== logo.url) { lineupCache.logos[j.id] = logo.url; saveLineup(); } }
    return { id: j.id, type: j.type, logo: logo ? artPath(logo.url, 240) : '', skipLimits: j.skipLimits || null };
}

function sweepStreams() {
    const cut = Date.now() - STREAM_IDLE_MS;
    for (const [sid, s] of streams) if (s.used < cut) streams.delete(sid);
}

/** An absolute upstream address for a playlist line, or null when it leaves SiriusXM's streaming hosts. */
function upstream(base, ref) {
    try {
        const u = new URL(ref, base);
        return u.protocol === 'https:' && STREAM_HOSTS.test(u.hostname) ? u.href : null;
    } catch (_) { return null; }
}

/**
 * Our copy of a playlist: relative lines unchanged (the folder is mirrored), an absolute address under the stream's
 * folder mapped into the mirror, the key line to /api/xmradio/key/<sid>/<keyId>; anything else is left as it is (and
 * never fetched by the server).
 */
function rewritePlaylist(sid, base, text) {
    const mirror = (abs) => (abs.startsWith(base) ? `/api/xmradio/live/${sid}/m/${abs.slice(base.length)}` : null);
    return String(text).split('\n').map((line) => {
        const l = line.trim();
        if (!l) return line;
        if (l.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/g, (m, ref) => {
                const key = ref.match(/\/playback\/key\/v1\/([0-9a-f-]{8,64})/i);
                if (key) return `URI="/api/xmradio/key/${sid}/${key[1]}"`;
                if (!/^https?:/i.test(ref)) return m;
                const mapped = mirror(ref);
                return mapped ? `URI="${mapped}"` : m;
            });
        }
        if (!/^https?:/i.test(l)) return line;
        return mirror(l) || line;
    }).join('\n');
}

async function mirrorFile(sid, rest, query, res) {
    const s = streams.get(sid);
    if (!s) { res.status(404).end(); return; }
    s.used = Date.now();
    let url;
    try { url = new URL(`${rest}${query || ''}`, s.base); } catch (_) { res.status(400).end(); return; }
    // only below the stream's own folder on SiriusXM's streaming hosts
    if (url.protocol !== 'https:' || !STREAM_HOSTS.test(url.hostname) || !url.href.startsWith(s.base)) { res.status(400).end(); return; }
    let up;
    try {
        up = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.siriusxm.com/' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (_) { res.status(502).end(); return; }
    if (!up.ok) { res.status(up.status === 404 ? 404 : 502).end(); return; }
    const type = up.headers.get('content-type') || '';
    if (/mpegurl/i.test(type) || /\.m3u8$/i.test(url.pathname) || url.href === s.url) {
        const text = await up.text();
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.set('Cache-Control', 'no-store');
        res.send(rewritePlaylist(sid, s.base, text));
        return;
    }
    res.set('Content-Type', type || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=600');
    res.send(Buffer.from(await up.arrayBuffer()));
}

/** The AES key for a stream: SiriusXM's key service with the token, as the raw 16 bytes HLS wants. */
async function streamKey(sid, keyId, res) {
    const s = streams.get(sid);
    if (!s || !/^[0-9a-f-]{8,64}$/i.test(keyId)) { res.status(404).end(); return; }
    s.used = Date.now();
    const tok = await authToken().catch(() => null);
    if (!tok) { res.status(401).end(); return; }
    let up;
    try {
        up = await fetch(`${API}/playback/key/v1/${keyId}`, { headers: { Authorization: `Bearer ${tok}`, 'User-Agent': UA, Origin: 'https://www.siriusxm.com', Referer: 'https://www.siriusxm.com/', 'x-sxm-clock': JSON.stringify([0, ++clock]) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (_) { res.status(502).end(); return; }
    if (!up.ok) { res.status(up.status === 401 ? 401 : 502).end(); return; }
    const buf = Buffer.from(await up.arrayBuffer());
    let key = buf;
    // a JSON reply carries the key in base64 (or hex)
    if (buf.length !== 16) {
        try {
            const j = JSON.parse(buf.toString('utf8'));
            const v = j.key || j.keyValue || j.value || j.data || '';
            key = /^[0-9a-f]{32}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(String(v), 'base64');
        } catch (_) { key = buf; }
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'private, no-store');
    res.send(key);
}

function mount(app, authMiddleware) {
    // the account is the administrator's (as Melaton Videos'): admin and dev_admin test tabs listen
    const admin = (req, res, next) => {
        if (req.userType !== 'admin' && req.userType !== 'dev_admin') { res.status(403).end(); return; }
        next();
    };
    app.get('/api/xmradio/live/:sid/m/*', authMiddleware, admin, (req, res) => {
        const q = req.originalUrl.indexOf('?');
        void mirrorFile(String(req.params.sid), String(req.params[0] || ''), q >= 0 ? req.originalUrl.slice(q) : '', res);
    });
    // SiriusXM art (song covers, channel logos) at our own address, kept a day in this process
    const artCache = new Map();
    app.get('/api/xmradio/art', authMiddleware, admin, async (req, res) => {
        const k = String(req.query.k || '');
        const size = Math.max(32, Math.min(600, Number(req.query.s) || 240));
        if (!ART_KEY.test(k)) { res.status(404).end(); return; }
        const ck = `${k}|${size}`;
        let hit = artCache.get(ck);
        if (!hit) {
            try {
                const r = await fetch(imageUrl(k, size), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
                if (!r.ok) { res.status(404).end(); return; }
                hit = { type: r.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await r.arrayBuffer()) };
            } catch (_) { res.status(502).end(); return; }
            artCache.set(ck, hit);
            if (artCache.size > 400) artCache.delete(artCache.keys().next().value);
        }
        res.set('Content-Type', hit.type);
        res.set('Cache-Control', 'private, max-age=86400');
        res.send(hit.body);
    });
    app.get('/api/xmradio/key/:sid/:keyId', authMiddleware, admin, (req, res) => { void streamKey(String(req.params.sid), String(req.params.keyId), res); });
}

module.exports = {
    bind,
    defineFeed,
    account,
    signInStatus,
    signInPassword,
    signOut,
    signInWithCard,
    saveCard,
    signInPageStart,
    signInPageCancel,
    mountSignInPage,
    tune,
    mount,
    lineup,
    logos,
    presets,
    setPresets,
    nowPlaying: (id) => nowPlaying.get(id) || null,
    _test: { rewritePlaylist, findStreamUrl, jwtExp, maskHandle, upstream, streams, imageUrl, artPath, state: () => load() }
};
