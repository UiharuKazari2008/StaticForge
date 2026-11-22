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
    // the radios' feed, the phones' feed and the deck's watch share one read every 10 s at most
    if (Date.now() - lookAt < 10000) return true;
    const url = `${LOOKAROUND}?delta=${encodeURIComponent(lookDelta)}`;
    let j;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        j = await res.json();
    } catch (_) { return false; }
    if (!j || !j.channels) return false;
    const now = Date.now();
    const channelCuts = new Map(); // channelId -> [{ at, a, t, s, ad, ik }] oldest first (the cassette deck's splits)
    for (const [id, c] of Object.entries(j.channels)) {
        const cuts = (c.cuts || []).filter((x) => Date.parse(x.validFrom) <= now).sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
        const shows = (c.shows || []).filter((x) => Date.parse(x.validFrom) <= now).sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
        const cut = cuts[0];
        const show = shows[0];
        if (!cut && !show) continue;
        const art = (cut && cut.image && cut.image.url) || (show && show.image && show.image.url) || '';
        const showAt = (t) => { const sh = shows.find((x) => Date.parse(x.validFrom) <= t); return sh ? String(sh.name || '') : ''; };
        const list = cuts.slice(0, 8).reverse().map((x) => ({ at: Date.parse(x.validFrom), a: String(x.artistName || ''), t: String(x.name || ''), ad: !!x.isAd, s: showAt(Date.parse(x.validFrom)), ik: (x.image && x.image.url) || '' }));
        if (list.length) channelCuts.set(id, list);
        nowPlaying.set(id, { a: cut ? String(cut.artistName || '') : '', t: cut ? String(cut.name || '') : '', ad: !!(cut && cut.isAd), s: show ? String(show.name || '') : '', i: art ? artPath(art, 300) : '', ik: art, at: cut ? Date.parse(cut.validFrom) : now, cuts: list });
    }
    if (j.delta) lookDelta = j.delta;
    lookAt = now;
    for (const fn of lookListeners) { try { fn(channelCuts); } catch (err) { console.warn(`[xmRadio] look listener: ${err.message}`); } }
    return true;
}

// The server's own reads of lookAround, for the cassette deck (recordings' splits, alerts, search terms): one timer,
// running only while something wants it, backing off when SiriusXM does not answer (rule phone-power-server 7).
const lookListeners = [];
const watchers = new Set();
let watchTimer = null;
let watchFails = 0;
function onLook(fn) { lookListeners.push(fn); }
function watch(reason, on) {
    if (on) watchers.add(reason); else watchers.delete(reason);
    if (watchers.size && !watchTimer) watchTimer = setTimeout(watchTick, 1000);
    if (!watchers.size && watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
}
async function watchTick() {
    watchTimer = null;
    if (!watchers.size) return;
    let ok = true;
    // a radio's status feed reads it as well: no second read inside the same 15 s
    if (Date.now() - lookAt > 15000) ok = await readLookAround();
    if (ok) watchFails = 0;
    else if ((watchFails += 1) <= 6) console.warn(`[xmRadio] lookAround did not answer (${watchFails})`);
    if (!watchers.size) return;
    watchTimer = setTimeout(watchTick, ok ? HUB_INTERVAL : Math.min(300000, HUB_INTERVAL * 2 ** Math.min(watchFails, 4)));
    if (watchTimer.unref) watchTimer.unref();
}
/** A channel's recent cuts, oldest first. */
function nowPlayingCuts(id) { const v = nowPlaying.get(id); return v && v.cuts ? v.cuts.slice() : []; }
/**
 * The lineup kept on disk, read into memory once: the recorder and the phone feed need it even when no radio has asked
 * for the lineup since the server started (a phone keeps its own copy a month, so it never asks; its Record answered
 * "No such channel." after every restart, Yukimi Nov 21 2026).
 */
function lineupKept() {
    if (!lineupCache) { try { lineupCache = JSON.parse(fs.readFileSync(lineupFile(), 'utf8')); } catch (_) { lineupCache = null; } }
    return lineupCache;
}
/** A channel of the lineup with its plan mark, or null. */
function channelById(id) {
    lineupKept();
    const c = lineupCache && lineupCache.channels && lineupCache.channels.find((x) => x.id === id);
    if (!c) return null;
    const no = new Set(lineupCache.notInPlan || []);
    return no.has(id) ? Object.assign({}, c, { sub: false }) : c;
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
            const items = { account: account(), lineup: lineupKept() && lineupCache.at ? { at: lineupCache.at, n: lineupCache.channels.length } : null };
            for (const [id, v] of nowPlaying) items[`ch:${id}`] = { a: v.a, t: v.t, s: v.s, ad: v.ad, i: v.i };
            // the cassette deck: its tape, its switch, what it is recording, the timers, alerts and terms
            try { items.deck = require('./xmRadioRecorder').deck(); } catch (_) { /* not started */ }
            return items;
        }
    });
    return hub;
}

function touch() {
    if (hub && typeof hub.poke === 'function') hub.poke();
    if (phoneHub && typeof phoneHub.poke === 'function') phoneHub.poke();
}

// ------------------------------------------------------------------ the phones' feed
// A phone (Today's item, the phone radio) gets only its channels (rule phone-power-server 4): the presets of every
// bank and the channels its sockets say they show (xmradio_phone_watch), not the whole lineup's cuts every 20 s.
let phoneHub = null;
const phoneWatch = new Map(); // ws -> Set(channelId)
function setPhoneWatch(ws, ids) {
    if (!ws) return [];
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[0-9a-f-]{20,64}$/i.test(x)))].slice(0, 12);
    if (!phoneWatch.has(ws) && typeof ws.once === 'function') ws.once('close', () => phoneWatch.delete(ws));
    phoneWatch.set(ws, new Set(list));
    if (phoneHub && typeof phoneHub.poke === 'function') phoneHub.poke();
    return list;
}
function phoneChannels() {
    const out = new Set();
    const p = presets();
    for (const b of ['A', 'B', 'C']) for (const id of p[b] || []) if (id) out.add(id);
    for (const set of phoneWatch.values()) for (const id of set) out.add(id);
    return out;
}
function definePhoneFeed(statusHub) {
    if (phoneHub || !statusHub) return phoneHub;
    phoneHub = statusHub.define({
        name: 'xmradio_phone',
        pushType: 'xmradio_phone_status',
        intervalMs: HUB_INTERVAL,
        allow: (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || ''))),
        sample: async () => {
            await readLookAround();
            const a = account();
            const items = { account: { signedIn: !!(a && a.signedIn) }, lineup: lineupKept() && lineupCache.at ? { at: lineupCache.at } : null, guide: { n: Object.keys((lineupCache && lineupCache.genres) || {}).length } };
            // the preset banks themselves (at most 30 ids; only a change is pushed): a phone kept the ones it read with
            // the lineup, once a month, so presets stored elsewhere never reached its Today (Yukimi, Nov 21 2026)
            const pr = presets();
            items.presets = { A: (pr.A || []).slice(0, 10), B: (pr.B || []).slice(0, 10), C: (pr.C || []).slice(0, 10) };
            // the deck as a phone shows it: what records now (no timers, alerts or terms lists)
            try { const d = require('./xmRadioRecorder').deck(); items.rec = d.recordings.map((r) => ({ rid: r.rid, channelId: r.channelId, kind: r.kind, since: r.since, back: r.back || 0, a: (r.cut && r.cut.a) || '', t: (r.cut && r.cut.t) || '', ad: !!(r.cut && r.cut.ad) })); } catch (_) { items.rec = []; }
            for (const id of phoneChannels()) {
                const v = nowPlaying.get(id);
                if (v) items[`ch:${id}`] = { a: v.a, t: v.t, s: v.s, ad: v.ad, i: v.i, at: v.at };
            }
            return items;
        }
    });
    return phoneHub;
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
/**
 * A channel's programme around now (the phone's Now Playing, Yukimi Nov 20 2026: "up next"): liveUpdate over the
 * last 90 minutes and the next 8 hours. Songs are known only once they air; shows are scheduled ahead.
 *   -> { now: { a, t, at, dur (s), i } | null, played: [{ a, t, at, dur, i }] (newest first, up to 12),
 *        shows: [{ name, show, at, dur, i, now? }] (the one on now, then what comes up) }
 * Kept a minute per channel.
 */
const scheduleCache = new Map();
const pickImage = (images) => {
    if (!images || typeof images !== 'object') return '';
    for (const k of ['tile', 'cover', 'thumbnail', 'logo']) {
        const v = images[k];
        if (!v) continue;
        for (const a of ['aspect_1x1', 'aspect_16x9', 'aspect_5x4']) {
            const im = v[a] && (v[a].preferredImage || v[a].defaultImage);
            if (im && im.url) return artPath(im.url, 300, 'jpeg', a === 'aspect_16x9' ? 16 / 9 : a === 'aspect_5x4' ? 1.25 : 1);
        }
    }
    return '';
};
async function schedule(channelId) {
    const id = String(channelId || '');
    if (!/^[0-9a-f-]{20,64}$/i.test(id)) throw fail('No such channel.', 'XMRADIO_CHANNEL');
    const hit = scheduleCache.get(id);
    if (hit && Date.now() - hit.at < 60000) return hit.data;
    const tok = await authToken();
    if (!tok) throw fail('Sign in to SiriusXM to listen.', 'XMRADIO_SIGNED_OUT');
    const now = Date.now();
    // liveUpdate answers a page from its start (about a dozen songs) and names where the next one starts: followed
    // until it reaches now (an hour back, at most six pages)
    const j = { items: [], episodes: [] };
    let from = now - 60 * 60000;
    for (let page = 0; page < 6; page++) {
        const r = await api('POST', '/playback/play/v1/liveUpdate', { bearer: tok, body: { channelId: id, startTimestamp: new Date(from).toISOString(), endTimestamp: new Date(now + 8 * 3600000).toISOString() } });
        const p = r.json || {};
        if (Array.isArray(p.items)) j.items.push(...p.items);
        if (Array.isArray(p.episodes)) j.episodes.push(...p.episodes);
        const next = Date.parse(p.nextLiveUpdateStartTimestamp || '');
        if (!next || next <= from || next >= now) break;
        from = next;
    }
    const seen = new Set();
    j.items = j.items.filter((x) => { const k = `${x.timestamp}|${x.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const seenEp = new Set();
    j.episodes = j.episodes.filter((x) => { const k = `${x.startTimestamp}|${x.name}`; if (seenEp.has(k)) return false; seenEp.add(k); return true; });
    const songs = (Array.isArray(j.items) ? j.items : []).map((x) => ({
        a: String(x.artistName || ''), t: String(x.name || ''), at: Date.parse(x.timestamp) || 0, dur: Math.round((Number(x.duration) || 0) / 1000), // liveUpdate gives milliseconds
        ad: !!x.isInterstitial, i: pickImage(x.images) || pickImage(x.artistImages)
    })).filter((x) => x.at && x.at <= now + 5000).sort((a, b) => b.at - a.at);
    const shows = (Array.isArray(j.episodes) ? j.episodes : []).map((x) => ({
        name: String(x.name || ''), show: String(x.showName || ''), at: Date.parse(x.startTimestamp) || 0, dur: Math.round((Number(x.duration) || 0) / 1000), // liveUpdate gives milliseconds
        i: pickImage(x.images) || pickImage(x.showImages)
    })).filter((x) => x.at).sort((a, b) => a.at - b.at)
        .filter((x) => x.at + x.dur * 1000 > now)
        .map((x) => (x.at <= now ? Object.assign(x, { now: true }) : x))
        .slice(0, 8);
    const cur = songs[0] && !songs[0].ad ? songs[0] : null;
    const data = { now: cur, played: songs.slice(cur ? 1 : 0).filter((x) => !x.ad).slice(0, 12), shows };
    scheduleCache.set(id, { at: Date.now(), data });
    if (scheduleCache.size > 40) scheduleCache.delete(scheduleCache.keys().next().value);
    return data;
}

/**
 * What is on now that matches the words (the phone's Search, Yukimi Nov 20 2026): artist, song, show or channel name,
 * every word found, on the channels in the plan. -> { results: [{ channelId, a, t, s }] } (up to 40)
 */
async function search(q) {
    const words = String(q || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return { results: [] };
    await readLookAround();
    const out = [];
    for (const c of (lineupCache && lineupCache.channels) || []) {
        const no = new Set(lineupCache.notInPlan || []);
        if (no.has(c.id)) continue;
        const v = nowPlaying.get(c.id) || {};
        const hay = `${v.a || ''} ${v.t || ''} ${v.s || ''} ${c.name} ${c.number}`.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        if (words.every((w) => hay.includes(w))) out.push({ channelId: c.id, a: v.ad ? '' : v.a || '', t: v.ad ? '' : v.t || '', s: v.s || '' });
        if (out.length >= 40) break;
    }
    return { results: out };
}

/**
 * The Channel Guide (the phone's, by genre): each channel's genre, read from its SiriusXM channel page once with its
 * logo and kept with the lineup. The pages still missing are read in the background (four at a time); the phones'
 * feed item `guide` says how many have one, so the Guide reads again as they come in.
 *   -> { genres: { channelId: 'Pop' }, missing: n }
 */
let guideFilling = null;
async function guide() {
    if (!lineupCache) await lineup().catch(() => null);
    const g = (lineupCache && lineupCache.genres) || {};
    const ids = ((lineupCache && lineupCache.channels) || []).map((c) => c.id);
    const missing = ids.filter((id) => !g[id]);
    if (missing.length && !guideFilling) {
        guideFilling = (async () => {
            for (let i = 0; i < missing.length; i += 20) {
                try { await logos(missing.slice(i, i + 20)); } catch (_) { break; }
                if (phoneHub && typeof phoneHub.poke === 'function') phoneHub.poke();
            }
        })().finally(() => { guideFilling = null; });
    }
    return { genres: g, missing: missing.length };
}

/**
 * A channel's genre, for the phone's Channel Guide. SiriusXM's channel pages carry none (genre and stationCategory are
 * null there); its web player's channel list does (decorations.genre), but only its first page of 30 could be read
 * (the next pages' query is not known), so those are used where they exist and every other channel is placed by the
 * words of its own name and description ("Pop hits from the MTV era" -> Pop).
 */
const GENRE_WORDS = [
    ['Sports', /\b(sports?|nfl|nba|mlb|nhl|nascar|pga|golf|espn|fantasy|play-by-play|college|soccer|football|baseball|hockey|racing|fight)\b/],
    ['News', /\b(news|cnn|fox news|msnbc|cnbc|bloomberg|bbc|politic|p\.o\.t\.u\.s|weather|traffic|c-span|npr)\b/],
    ['Comedy', /\b(comedy|laugh|funny|comedians?|stand-?up|jeff & larry)\b/],
    ['Kids', /\b(kids?|children|family|disney|totally|radio disney)\b/],
    ['Religion', /\b(christian|gospel|catholic|worship|praise|faith|church|god)\b/],
    ['Latin', /\b(latin[oa]?|latinx|espa[nñ]ol|reggaet[oó]n|salsa|tropical|mexican|regional mexican|caliente|bachata)\b/],
    ['Hip-Hop & R&B', /\b(hip-?hop|rap|r&b|soul|urban|slow jamz?|funk|motown)\b/],
    ['Dance & Electronic', /\b(dance|edm|electronic|house|techno|trance|club|chill|bpm|diplo|dj)\b/],
    ['Country', /\b(country|bluegrass|americana|outlaw|nashville|honky)\b/],
    ['Jazz & Standards', /\b(jazz|standards|swing|big band|sinatra|blues|crooners?)\b/],
    ['Classical', /\b(classical|symphon|opera|orchestra|chamber|baroque|pops)\b/],
    ['Rock', /\b(rock|metal|punk|alternative|alt|indie|grunge|classic vinyl|deep tracks|lithium|ozzy|hair nation|liquid metal|octane|grateful dead|pearl jam|springsteen|beatles|stones|petty|u2|bon jovi)\b/],
    ['Pop', /\b(pop|hits|top 40|80s|90s|70s|60s|50s|40s|00s|decade|love|soft|adult|today|now|mtv|throwback|taylor|swift)\b/],
    ['Talk', /\b(talk|stern|howard|podcast|radio andy|show|conversation|stories|book|health|money|business|entertainment|life)\b/]
];
function classify(name, description) {
    const t = `${name || ''} ${description || ''}`.toLowerCase();
    for (const [g, re] of GENRE_WORDS) if (re.test(t)) return g;
    return 'Other';
}
let officialGenres = null; // channelId -> SiriusXM's own genre (the web player's channel list, its first page)
async function readOfficialGenres(tok) {
    if (officialGenres) return officialGenres;
    officialGenres = {};
    try {
        const eh = (auth && auth.entitlementHash) || '';
        const r = await api('GET', '/browse/v1/pages/curated-grouping/403ab6a5-d3c9-4c2a-a722-a94a6a5fd056', { bearer: tok, query: { entitlementHash: eh } });
        for (const c of (r.json && r.json.page && r.json.page.containers) || []) {
            for (const st of c.sets || []) {
                for (const it of st.items || []) {
                    const id = it && it.entity && it.entity.id;
                    const g = it && it.decorations && it.decorations.genre;
                    if (id && typeof g === 'string' && g) officialGenres[id] = g;
                }
            }
        }
    } catch (_) { /* placed by their words */ }
    return officialGenres;
}

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
    lineupKept();
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
        if (logos[c.id]) { const l = artRef(logos[c.id], 1.25); out.logo = artPath(l.u, 240, 'png', l.a); }
        const bg = lineupCache.backgrounds && lineupCache.backgrounds[c.id];
        if (bg) { const g = artRef(bg, 4 / 3); out.bg = artPath(g.u, 480, 'jpeg', g.a); }
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
    if (!lineupCache) return { logos: {}, backgrounds: {} };
    const want = [...new Set((ids || []).map(String))].filter((id) => /^[0-9a-f-]{20,64}$/i.test(id)).slice(0, 60);
    lineupCache.logos = lineupCache.logos || {};
    lineupCache.backgrounds = lineupCache.backgrounds || {};
    // a channel read before backgrounds were kept is read again once for its background
    // (and once for its genre: the phone's Channel Guide)
    const missing = want.filter((id) => !(id in lineupCache.logos) || !(id in lineupCache.backgrounds) || !(lineupCache.genres || {})[id]);
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
                        const ims = (r.json && r.json.page && r.json.page.entity && r.json.page.entity.images) || {};
                        const pickI = (o) => o && (o.preferred || o.default || o.preferredImage || o.defaultImage);
                        lineupCache.logos[id] = imgRef(pickI(ims.logo && ims.logo.aspect_5x4), 1.25) || '';
                        // the channel's background picture (its genre's art), behind the colour screens' text: the 4:3
                        // one first (the receivers' screens are about that shape)
                        const bgObj = ims.background || ims.tile_background || {};
                        const bg = pickI(bgObj.aspect_4x3) || pickI(bgObj.aspect_16x9) || pickI(bgObj.aspect_15x7) || pickI(Object.values(bgObj)[0]);
                        lineupCache.backgrounds = lineupCache.backgrounds || {};
                        lineupCache.backgrounds[id] = imgRef(bg, 4 / 3) || '';
                        // the channel's genre, for the phone's Guide: SiriusXM's own where its list gives one, else by its words
                        lineupCache.genres = lineupCache.genres || {};
                        const ent = (r.json && r.json.page && r.json.page.entity) || {};
                        const tx = ent.texts || {};
                        const official = (await readOfficialGenres(tok))[id];
                        lineupCache.genres[id] = official || classify(tx.title && (tx.title.default || tx.title.medium), tx.description && (tx.description.long || tx.description.default));
                        found++;
                    } catch (_) { /* asked again next time */ }
                }
            }));
            if (found) saveLineup();
        }
    }
    const out = {};
    const bgs = {};
    for (const id of want) {
        if (lineupCache.logos[id]) { const l = artRef(lineupCache.logos[id], 1.25); out[id] = artPath(l.u, 240, 'png', l.a); }
        const b = lineupCache.backgrounds && lineupCache.backgrounds[id];
        if (b) { const g = artRef(b, 4 / 3); bgs[id] = artPath(g.u, 480, 'jpeg', g.a); }
    }
    return { logos: out, backgrounds: bgs };
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
    for (const b of ['A', 'B', 'C']) out[b] = Array.isArray(p[b]) ? p[b].slice(0, 10).map((x) => (typeof x === 'string' && /^[0-9a-f-]{20,64}$/i.test(x) ? x : null)) : [];
    return out;
}

function setPresets(next) {
    const s = load();
    const clean = {};
    for (const b of ['A', 'B', 'C']) clean[b] = Array.isArray(next && next[b]) ? next[b].slice(0, 10).map((x) => (typeof x === 'string' && /^[0-9a-f-]{20,64}$/i.test(x) ? x : null)) : [];
    s.presets = clean;
    save();
    return presets();
}

// ------------------------------------------------------------------ tuning and the stream

const QUALITIES = ['hi', 'std', 'low', 'eco24', 'eco16'];

/** tuneSource with the web player's arguments: { json, url } (the stream's master playlist on SiriusXM's server). */
async function tuneUpstream(channelId) {
    const id = String(channelId || '');
    if (!/^[0-9a-f-]{20,64}$/i.test(id)) throw fail('No such channel.', 'XMRADIO_CHANNEL');
    const tok = await authToken();
    if (!tok) throw fail('Sign in to SiriusXM to listen.', 'XMRADIO_SIGNED_OUT');
    const body = { id, type: 'channel-linear', manifestVariant: 'WEB', trackResumeSupported: false, hlsVersion: 'V3', mtcVersion: 'V2' };
    const r = await api('POST', '/playback/play/v1/tuneSource', { bearer: tok, body });
    if (r.status === 401) { auth = null; throw fail('The SiriusXM sign-in ended. Sign in again.', 'XMRADIO_SIGNED_OUT'); }
    if (r.status === 403 && r.json && /not-entitled/.test(String(r.json.code || ''))) {
        noteNotInPlan(id);
        throw fail('This channel is not in your SiriusXM plan.', 'XMRADIO_NOT_SUBSCRIBED');
    }
    if (!r.json) throw fail('SiriusXM did not tune the channel.', 'XMRADIO_TUNE', { status: r.status, detail: r.text.slice(0, 400) });
    const url = findStreamUrl(r.json);
    if (!url) throw fail('SiriusXM did not give the channel a stream.', 'XMRADIO_TUNE', { status: r.status, detail: JSON.stringify(r.json).slice(0, 600) });
    return { json: r.json, url };
}

/**
 * A channel for a radio at a quality (the faceplate's switch, Yukimi Nov 20 2026): hi / std / low are SiriusXM's own
 * 256k / 128k / 32k streams (our copy of the master names only that one, so no player climbs to 256k on a weak link);
 * eco24 / eco16 are Opus re-encoded on the server (startEco).
 */
async function tune(channelId, opts = {}) {
    const id = String(channelId || '');
    const quality = QUALITIES.includes(opts.quality) ? opts.quality : 'hi';
    // replay (the phone's Recently Played, its scrub bar): start this many seconds behind live, within the stream's
    // five hours (#EXT-X-START in our copy of the media playlists; hls.js and the app's ExoPlayer both honour it)
    const back = Math.max(0, Math.min(5 * 3600 - 120, Math.round(Number(opts.back) || 0)));
    const { json, url } = await tuneUpstream(id);
    if (quality === 'eco24' || quality === 'eco16') {
        const relay = await startEco(id, quality === 'eco16' ? 16 : 24);
        return { sid: relay.rid, url: `/api/xmradio/eco/${relay.rid}/index.m3u8`, quality, channel: describeTune(json) };
    }
    const sid = crypto.randomBytes(12).toString('hex');
    // the stream's folder on SiriusXM's server is mirrored under /api/xmradio/live/<sid>/m/: the playlists' own relative
    // lines (about 1,850 a variant: five hours of replay) pass through unchanged
    const up = new URL(url);
    const base = new URL('./', up).href;
    streams.set(sid, { sid, channelId: id, url, base, quality, back, used: Date.now() });
    sweepStreams();
    return { sid, url: `/api/xmradio/live/${sid}/m/${up.href.slice(base.length)}`, quality, back, channel: describeTune(json) };
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
/**
 * Our address for a SiriusXM art key at a width, in the picture's own proportions (aspect = width / height of the
 * original): the image service squashes a picture into whatever box it is asked for, it never letterboxes.
 */
// ---- the Today panel icons made from the channels' logos (/api/xmradio/tiicon)
const TI_VERSION = 3; // 3: cropped to its visible pixels, sized and centred as the Music icon (Nov 21 2026)
const tiMem = new Map(); // `${key}|${scale}` -> Buffer (at most 300)
const tiBusy = new Map();
function tiDir() {
    return path.join(__dirname, '..', '.cache', 'xmradio-ti');
}

async function tiIcon(key, scale, aspect = 1) {
    const ck = `${key}|${scale}`;
    const have = tiMem.get(ck);
    if (have) return have;
    if (tiBusy.has(ck)) return tiBusy.get(ck);
    const job = (async () => {
        const file = path.join(tiDir(), `${crypto.createHash('sha1').update(`${TI_VERSION}|${ck}`).digest('hex')}.png`);
        let body = await fs.promises.readFile(file).catch(() => null);
        if (!body) {
            // the logo at its own shape (a stored aspect, 5:4 for most), so nothing is stretched
            const r = await fetch(imageUrl(key, 480, 'png', Math.round(480 / aspect)), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
            if (!r.ok) throw new Error(`logo ${r.status}`);
            body = await drawTiIcon(Buffer.from(await r.arrayBuffer()), scale);
            await fs.promises.mkdir(tiDir(), { recursive: true }).catch(() => {});
            await fs.promises.writeFile(file, body).catch(() => {});
        }
        tiMem.set(ck, body);
        if (tiMem.size > 300) tiMem.delete(tiMem.keys().next().value);
        return body;
    })().finally(() => tiBusy.delete(ck));
    tiBusy.set(ck, job);
    return job;
}

/** The logo as a Today panel icon, sized and centred as the ROM's Music icon (modules/wm65PanelIcon.js); 43 x 57 per 1x. */
async function drawTiIcon(logo, scale) {
    return require('./wm65PanelIcon').logoPanelIcon(logo, scale / 2);
}

/** The address of a channel's Today panel icon (a 4x drawing; the panel shows it at 43 x 57). */
function tiIconPath(key, aspect = 1) {
    const a = Math.round(Math.max(0.2, Math.min(5, Number(aspect) || 1)) * 1000) / 1000;
    return ART_KEY.test(String(key || '')) ? `/api/xmradio/tiicon?k=${encodeURIComponent(key)}&a=${a}&x=4&v=${TI_VERSION}` : '';
}

// ---- the channels' art as the radio shows it (/api/xmradio/art): made once from the image service's picture and kept
// processed, never the original (Yukimi, Nov 21 2026: "make sure that in the xm radio cache you are not storing the
// original and have them precropped for everyone and already optimised, same for album art"): logos (PNG) trimmed of
// their empty edge and saved as a small palette PNG, pictures (JPEG) re-encoded as compact progressive JPEG at the size
// asked for; on disk for every client and restart, in memory for the hot ones.
const ART_VERSION = 1;
const artBusy = new Map();
function artDir() {
    return path.join(__dirname, '..', '.cache', 'xmradio-art');
}

async function processedArt(key, size, height, fmt) {
    const ck = `${ART_VERSION}|${key}|${size}|${height}|${fmt}`;
    if (artBusy.has(ck)) return artBusy.get(ck);
    const job = (async () => {
        const file = path.join(artDir(), `${crypto.createHash('sha1').update(ck).digest('hex')}.${fmt === 'png' ? 'png' : 'jpg'}`);
        const type = fmt === 'png' ? 'image/png' : 'image/jpeg';
        const kept = await fs.promises.readFile(file).catch(() => null);
        if (kept) return { type, body: kept };
        const r = await fetch(imageUrl(key, size, fmt, height), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!r.ok) throw Object.assign(new Error(`art ${r.status}`), { notFound: r.status === 404 });
        const src = Buffer.from(await r.arrayBuffer());
        const sharp = require('sharp');
        let body;
        if (fmt === 'png') {
            const trimmed = await sharp(src).ensureAlpha().trim({ threshold: 8 }).png().toBuffer().catch(() => src);
            body = await sharp(trimmed).png({ palette: true, quality: 90, effort: 7, compressionLevel: 9 }).toBuffer();
        } else {
            body = await sharp(src).jpeg({ quality: 80, mozjpeg: true, progressive: true }).toBuffer();
        }
        // never larger than what the service sent
        if (body.length > src.length) body = fmt === 'png' ? body : src;
        await fs.promises.mkdir(artDir(), { recursive: true }).catch(() => {});
        await fs.promises.writeFile(file, body).catch(() => {});
        return { type, body };
    })().finally(() => artBusy.delete(ck));
    artBusy.set(ck, job);
    return job;
}

function artPath(key, size = 240, format = 'jpeg', aspect = 1) {
    const k = String(key || '');
    if (!ART_KEY.test(k)) return '';
    const w = Math.max(32, Math.min(600, Math.round(size)));
    const h = Math.max(16, Math.min(600, Math.round(w / (aspect > 0 ? aspect : 1))));
    // channel logos as PNG: their transparency kept (Yukimi, Nov 20 2026)
    return `/api/xmradio/art?k=${encodeURIComponent(k)}&s=${w}&h=${h}${format === 'png' ? '&f=png' : ''}`;
}

/** A stored art reference: { u, a } (key, aspect); an older plain key was a 5:4 logo. */
const artRef = (v, fallbackAspect) => (v && typeof v === 'object' ? v : { u: String(v || ''), a: fallbackAspect });
const imgRef = (im, fallbackAspect) => (im && im.url ? { u: String(im.url), a: im.width && im.height ? im.width / im.height : fallbackAspect } : null);

/** SiriusXM's image service: a relative art key (aem/..., if/...) as a sized JPEG address. */
function imageUrl(key, size = 300, format = 'jpeg', height = size) {
    if (!key) return '';
    if (/^https?:/.test(key)) return key;
    const spec = { key, edits: [{ resize: { width: size, height } }, { format: { type: format === 'png' ? 'png' : 'jpeg' } }] };
    return `https://imgsrv-sxm-prod-device.streaming.siriusxm.com/${Buffer.from(JSON.stringify(spec)).toString('base64')}`;
}

function describeTune(j) {
    const im = (j && j.images) || {};
    const pickImg = (o) => o && (o.preferredImage || o.defaultImage);
    const logo = pickImg(im.logo && im.logo.aspect_5x4) || pickImg(im.tile && im.tile.aspect_1x1);
    const ref = imgRef(logo, 1.25);
    if (ref && lineupCache) { lineupCache.logos = lineupCache.logos || {}; const had = artRef(lineupCache.logos[j.id], 1.25); if (had.u !== ref.u) { lineupCache.logos[j.id] = ref; saveLineup(); } }
    return { id: j.id, type: j.type, logo: ref ? artPath(ref.u, 240, 'png', ref.a) : '', tiIcon: ref ? tiIconPath(ref.u, ref.a) : '', skipLimits: j.skipLimits || null };
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

/** A master playlist naming only the variant nearest the quality's bandwidth. */
function onlyVariant(master, quality) {
    const want = { hi: 256000, std: 128000, low: 32000 }[quality];
    if (!want) return master;
    const lines = master.split('\n');
    let best = -1;
    let bestBw = 0;
    lines.forEach((l, i) => {
        const m = /^#EXT-X-STREAM-INF:.*?BANDWIDTH=(\d+)/.exec(l);
        if (m && (best < 0 || Math.abs(Number(m[1]) - want) < Math.abs(bestBw - want))) { best = i; bestBw = Number(m[1]); }
    });
    if (best < 0) return master;
    return lines.filter((l, i) => !(/^#EXT-X-STREAM-INF/.test(l) && i !== best) && !(i > 0 && /^#EXT-X-STREAM-INF/.test(lines[i - 1]) && i - 1 !== best)).join('\n');
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
        let text = await up.text();
        if (url.href === s.url && s.quality && s.quality !== 'auto') text = onlyVariant(text, s.quality);
        if (s.back && /#EXTINF/.test(text) && !/#EXT-X-START/.test(text)) text = text.replace(/^#EXTM3U[^\n]*\n/, (m) => `${m}#EXT-X-START:TIME-OFFSET=-${s.back},PRECISE=YES\n`);
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.set('Cache-Control', 'no-store');
        res.send(rewritePlaylist(sid, s.base, text));
        return;
    }
    res.set('Content-Type', type || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=600');
    res.send(Buffer.from(await up.arrayBuffer()));
}

/** A key line's 16 bytes (the pump's decryption): SiriusXM's key service with the account's token. */
async function keyBytes(uri) {
    const m = /\/playback\/key\/v1\/([0-9a-f-]{8,64})/i.exec(String(uri || ''));
    if (!m) throw fail('Not a SiriusXM key.', 'XMRADIO_KEY');
    const tok = await authToken();
    if (!tok) throw fail('Sign in to SiriusXM to listen.', 'XMRADIO_SIGNED_OUT');
    const r = await api('GET', `/playback/key/v1/${m[1]}`, { bearer: tok });
    const v = r.json && (r.json.key || r.json.keyValue);
    if (!v) throw fail('SiriusXM did not give the key.', 'XMRADIO_KEY', { status: r.status });
    return /^[0-9a-f]{32}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(String(v), 'base64');
}

// ------------------------------------------------------------------ ECO: Opus re-encoded on the server

/*
 * The faceplate's ECO positions (Yukimi, Nov 20 2026: "low bandwidth mode where the server can re-encode the stream at
 * a lower bitrate that sounds good but can be played on a very low bandwidth connection"): the channel's 128k stream
 * through the pump (modules/xmRadioPump.js) into ffmpeg, Opus at 24 or 16 kbit/s in fMP4 HLS (4 s pieces, an hour
 * kept for replay) under <cache>/xmradio-eco/<rid>/. One relay per channel and rate, shared; it stops two minutes after
 * nobody asked for it.
 */
const ECO_IDLE_MS = 2 * 60 * 1000;
const relays = new Map(); // rid -> { rid, channelId, kbps, dir, ff, pump, used, dead }
let ecoSweep = null;

function ecoRoot() { return path.join(path.dirname(accountFile()), 'xmradio-eco'); }

async function startEco(channelId, kbps) {
    for (const r of relays.values()) {
        if (r.channelId === channelId && r.kbps === kbps && !r.dead) { r.used = Date.now(); return r; }
    }
    const { spawn } = require('child_process');
    const rid = crypto.randomBytes(12).toString('hex');
    const dir = path.join(ecoRoot(), rid);
    fs.mkdirSync(dir, { recursive: true });
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'aac', '-i', 'pipe:0',
        '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-application', 'audio',
        '-f', 'hls', '-hls_time', '4', '-hls_list_size', '900', '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
        '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', path.join(dir, 's%05d.m4s'),
        path.join(dir, 'index.m3u8')], { stdio: ['pipe', 'ignore', 'pipe'] });
    const relay = { rid, channelId, kbps, dir, ff, pump: null, used: Date.now(), dead: false };
    relays.set(rid, relay);
    ff.stderr.on('data', (d) => console.warn(`[xmRadio eco] ${String(d).trim().slice(0, 200)}`));
    ff.stdin.on('error', () => { /* ffmpeg ended */ });
    ff.on('exit', () => stopEco(rid));
    const pump = require('./xmRadioPump').createPump({
        channelId, quality: 'std', keyBytes,
        tune: async (id) => tuneUpstream(id),
        log: (lvl, t) => console.warn(t)
    });
    relay.pump = pump;
    pump.on('segment', (sg) => { if (!relay.dead) ff.stdin.write(sg.adts); });
    pump.on('error', () => stopEco(rid));
    pump.start({ back: 12 });
    if (!ecoSweep) {
        ecoSweep = setInterval(() => {
            for (const r of relays.values()) if (Date.now() - r.used > ECO_IDLE_MS) stopEco(r.rid);
            if (!relays.size) { clearInterval(ecoSweep); ecoSweep = null; }
        }, 30000);
        if (ecoSweep.unref) ecoSweep.unref();
    }
    return relay;
}

function stopEco(rid) {
    const r = relays.get(rid);
    if (!r || r.dead) return;
    r.dead = true;
    relays.delete(rid);
    try { r.pump && r.pump.stop(); } catch (_) { /* stopped */ }
    try { r.ff.stdin.end(); } catch (_) { /* gone */ }
    try { r.ff.kill('SIGTERM'); } catch (_) { /* gone */ }
    setTimeout(() => fs.rm(r.dir, { recursive: true, force: true }, () => {}), 2000);
}

async function ecoFile(rid, file, res) {
    const r = relays.get(rid);
    if (!r || !/^(index\.m3u8|init\.mp4|s\d{5}\.m4s)$/.test(file)) { res.status(404).end(); return; }
    r.used = Date.now();
    const p = path.join(r.dir, file);
    // the first playlist comes once ffmpeg has its first piece (a few seconds after the channel was tuned)
    for (let i = 0; i < 60 && !fs.existsSync(p); i++) await new Promise((ok) => setTimeout(ok, 300));
    if (!fs.existsSync(p)) { res.status(404).end(); return; }
    res.set('Cache-Control', file === 'index.m3u8' ? 'no-store' : 'private, max-age=3600');
    res.type(file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4');
    res.sendFile(file, { root: r.dir });
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
        const height = Math.max(16, Math.min(600, Number(req.query.h) || size));
        const fmt = req.query.f === 'png' ? 'png' : 'jpeg';
        if (!ART_KEY.test(k)) { res.status(404).end(); return; }
        const ck = `${k}|${size}|${height}|${fmt}`;
        let hit = artCache.get(ck);
        if (!hit) {
            try { hit = await processedArt(k, size, height, fmt); } catch (err) { res.status(err && err.notFound ? 404 : 502).end(); return; }
            if (!hit) { res.status(404).end(); return; }
            artCache.set(ck, hit);
            if (artCache.size > 400) artCache.delete(artCache.keys().next().value);
        }
        res.set('Content-Type', hit.type);
        // the same picture for everyone and for good (the address names the picture and its size)
        res.set('Cache-Control', 'private, max-age=2592000');
        res.send(hit.body);
    });
    // a channel's logo as a Windows Mobile 6.5 Today panel icon (Yukimi, Nov 21 2026: "you need to crop them, optimise
    // them and add their reflection like other apps have, cache them"): the logo trimmed of its empty edge, fitted to
    // the panel icon's box and standing on its bottom, its fading mirror below (as scripts/generate-wm-xmradio-art.js
    // draws the apps' own: 86 x 113 per 2x), a small palette PNG; made once per logo and scale, kept on disk and in
    // memory, sent to be kept a year (the address carries the logo's key and the drawing's version)
    app.get('/api/xmradio/tiicon', authMiddleware, admin, async (req, res) => {
        const k = String(req.query.k || '');
        const scale = [1, 2, 4].includes(Number(req.query.x)) ? Number(req.query.x) : 4;
        const aspect = Math.max(0.2, Math.min(5, Number(req.query.a) || 1));
        if (!ART_KEY.test(k)) { res.status(404).end(); return; }
        try {
            const body = await tiIcon(k, scale, aspect);
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'private, max-age=31536000, immutable');
            res.send(body);
        } catch (_) { res.status(502).end(); }
    });
    app.get('/api/xmradio/eco/:rid/:file', authMiddleware, admin, (req, res) => { void ecoFile(String(req.params.rid), String(req.params.file), res); });
    app.get('/api/xmradio/key/:sid/:keyId', authMiddleware, admin, (req, res) => { void streamKey(String(req.params.sid), String(req.params.keyId), res); });
    // a channel at an address of its own (the app's native player: next / previous channel and the alarm's radio
    // with the page asleep): tunes now and sends the player to our copy of the stream (?q quality, ?back seconds)
    app.get('/api/xmradio/channel/:id.m3u8', authMiddleware, admin, async (req, res) => {
        try {
            const t = await tune(String(req.params.id), { quality: String(req.query.q || 'std'), back: Number(req.query.back) || 0 });
            res.set('Cache-Control', 'no-store');
            res.redirect(302, t.url);
        } catch (err) { res.status(err && err.code === 'XMRADIO_SIGNED_OUT' ? 401 : err && err.code === 'XMRADIO_NOT_SUBSCRIBED' ? 403 : 502).json({ error: (err && err.message) || 'not tuned' }); }
    });
    // what is on a channel for the app's media notification: the song, its start and length (the player asks again
    // when the song is due to end, never on a timer), its cover at the image service's own public address
    app.get('/api/xmradio/now/:id', authMiddleware, admin, async (req, res) => {
        const id = String(req.params.id);
        try {
            await readLookAround();
            const v = nowPlaying.get(id);
            let dur = 0;
            try { const sc = await schedule(id); if (sc.now && v && sc.now.t === v.t) dur = sc.now.dur; } catch (_) { /* no length */ }
            const c = channelById(id);
            const art = v && !v.ad && v.ik ? imageUrl(v.ik, 300) : '';
            res.set('Cache-Control', 'no-store');
            res.json({ channel: c ? `${c.number} ${c.name}` : '', a: v ? v.a : '', t: v ? v.t : '', s: v ? v.s : '', ad: !!(v && v.ad), at: v ? v.at : 0, dur, art });
        } catch (_) { res.status(502).end(); }
    });
    // a recording on a tape (the phone's Recordings: the native player plays it from here, with Range)
    app.get('/api/xmradio/track/:fileId', authMiddleware, admin, (req, res) => {
        require('./xmRadioRecorder').trackPath(String(req.params.fileId)).then((p) => {
            if (!p) { res.status(404).end(); return; }
            res.set('Cache-Control', 'private, max-age=3600');
            res.type('audio/mp4');
            res.sendFile(p.file, { root: p.root });
        }, () => res.status(404).end());
    });
    // a recording in progress (the cassette deck): its growing playlist and its segments, already decrypted
    app.get('/api/xmradio/rec/:rid/:file', authMiddleware, admin, (req, res) => {
        const rec = require('./xmRadioRecorder');
        const rid = String(req.params.rid);
        const f = String(req.params.file);
        if (f === 'index.m3u8') {
            const text = rec.playlist(rid);
            if (!text) { res.status(404).end(); return; }
            res.set('Cache-Control', 'no-store');
            res.type('application/vnd.apple.mpegurl').send(text);
            return;
        }
        const seg = rec.segPath(rid, f);
        if (!seg) { res.status(404).end(); return; }
        res.set('Cache-Control', 'private, max-age=3600');
        res.type('audio/aac');
        res.sendFile(seg.f, { root: seg.root });
    });
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
    tuneUpstream,
    keyBytes,
    mount,
    lineup,
    logos,
    presets,
    setPresets,
    nowPlaying: (id) => nowPlaying.get(id) || null,
    nowPlayingCuts,
    schedule,
    search,
    guide,
    channelById,
    watch,
    onLook,
    touch,
    definePhoneFeed,
    setPhoneWatch,
    accountFilePath: () => accountFile(),
    imageUrlFor: (key, size) => imageUrl(key, size, 'jpeg', size),
    _test: { classify, rewritePlaylist, findStreamUrl, jwtExp, maskHandle, upstream, streams, imageUrl, artPath, onlyVariant, state: () => load() }
};
