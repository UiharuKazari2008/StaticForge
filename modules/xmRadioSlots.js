'use strict';
/**
 * XM Radio's per-slot SiriusXM accounts (Yozora #1252 S2): the recorder is a pool of N virtual radios, each its own
 * SiriusXM account with its own device and its own session (SiriusXM allows one stream per account, which is why the
 * old Lizumi farm ran one emulator per login). Slot 1 IS the radio app's account (modules/xmRadio.js, its account file,
 * its module singletons), reached here through an adapter so nothing about the radio changes; slots 2..N are sessions
 * made by this factory, one instance each, kept in <cache>/xmradio-slots.json (0600):
 *
 *   { count, accounts: [{ slot, name 'Lizumi-Recorder-<n>', handle, deviceId, grant, grantExpiresAt, refreshGrant,
 *                         refreshGrantExpiresAt, identityId, identityGrant, signedIn, since, signedOut,
 *                         lastError, lastErrorAt }] }
 *
 * Only Dreamscape signs a slot in or out and writes that file (the recorder service never opens a SiriusXM session of
 * its own: a session started from a second process was refused, Nov 20 2026); Dreamscape hands each slot's access token
 * to the service (op auth { slot, token, exp, entitlementHash }), which holds one per slot. An empty slot ("Not set
 * up") owns no device until somebody signs in on it. A password is used once and never kept.
 *
 * Entitlement is learned, not read: a tuneSource refusal for a channel is remembered for that slot's account in
 * <cache>/xmradio-slot-entitlement.json ({ "<slot>": { hash, refused: [channelId] } }); a changed entitlementHash (the
 * plan changed) clears the slot's refusals. Either process writes it (the recorder is the one that tunes), the other
 * reads it back by mtime. slotCanPlay(slot, channelId) is what the dispatcher (S3) asks.
 */

const fs = require('fs');
const path = require('path');

const MAX_SLOTS = 8;
const DEFAULT_COUNT = 4; // the recorder's MAX_AUTO

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const GRANT_KEYS = ['deviceId', 'grant', 'grantExpiresAt', 'refreshGrant', 'refreshGrantExpiresAt'];

/**
 * deps: { api, fail, UA, APP_VERSION, maskHandle, dir (the cache folder), external () (the recorder service: never
 * signs in, never writes the slots file), slot1 (the adapter over xmRadio's singletons), changed () }
 */
function create(deps) {
    const { api, fail, maskHandle } = deps;
    const slotsFile = () => path.join(deps.dir(), 'xmradio-slots.json');
    const entFile = () => path.join(deps.dir(), 'xmradio-slot-entitlement.json');
    let doc = null; // { count, accounts[] }
    const runtime = new Map(); // slot -> { anon, auth, inflight }

    const rt = (slot) => {
        let r = runtime.get(slot);
        if (!r) { r = { anon: null, auth: null, inflight: null }; runtime.set(slot, r); }
        return r;
    };

    function checkSlot(slot) {
        const n = Number(slot);
        if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) throw fail(`There is no slot ${slot}.`, 'XMRADIO_SLOT');
        return n;
    }
    const nameOf = (n) => `Lizumi-Recorder-${n}`;

    function writeAtomic(f, text) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const tmp = `${f}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, text, { mode: 0o600 });
        fs.renameSync(tmp, f);
    }

    function load() {
        if (doc) return doc;
        let j = null;
        try { j = JSON.parse(fs.readFileSync(slotsFile(), 'utf8')); } catch (_) { j = null; }
        const count = Math.max(1, Math.min(MAX_SLOTS, Number(j && j.count) || DEFAULT_COUNT));
        const accounts = Array.isArray(j && j.accounts) ? j.accounts.filter((a) => a && Number.isInteger(a.slot) && a.slot >= 2 && a.slot <= MAX_SLOTS) : [];
        doc = { count, accounts };
        return doc;
    }

    /** The slot's account entry (slots 2..N), made empty when it has none yet. */
    function entry(slot) {
        const d = load();
        let e = d.accounts.find((a) => a.slot === slot);
        if (!e) {
            e = { slot, name: nameOf(slot), signedIn: false };
            d.accounts.push(e);
            d.accounts.sort((a, b) => a.slot - b.slot);
        }
        return e;
    }

    function save() {
        if (deps.external()) return;
        const d = load();
        // every slot up to the count is in the file, empty ones as "Not set up"
        for (let n = 2; n <= d.count; n++) entry(n);
        writeAtomic(slotsFile(), JSON.stringify({ count: d.count, accounts: d.accounts }, null, 2));
    }

    const changed = () => { try { deps.changed(); } catch (_) { /* a listener must not break a sign-in */ } };

    const isSignedIn = (e) => !!e.identityId && !e.signedOut;

    function noteError(e, message) {
        e.lastError = String(message || '').slice(0, 300);
        e.lastErrorAt = Date.now();
    }

    // -------------------------------------------------------------- the device and its sessions (slots 2..N)

    async function ensureDevice(e) {
        const now = Date.now();
        const r = rt(e.slot);
        if (!e.grant || !e.refreshGrant || (e.refreshGrantExpiresAt && Date.parse(e.refreshGrantExpiresAt) < now + 60000)) {
            // each slot registers its OWN device: a separate device with its own session
            const res = await api('POST', '/device/v2/devices', {
                body: { devicePlatform: 'web-desktop', deviceAttributes: { browser: { app: 'web-player', appVersion: deps.APP_VERSION, userAgent: deps.UA } }, grantVersion: 'v2', tenant: 'sxm' }
            });
            if (!res.json || !res.json.grant) throw fail('SiriusXM did not register this radio.', 'XMRADIO_DEVICE', { status: res.status });
            Object.assign(e, pick(res.json, GRANT_KEYS));
            // a new device knows no account
            delete e.identityId;
            delete e.identityGrant;
            e.signedIn = false;
            r.anon = null;
            r.auth = null;
            save();
        } else if (e.grantExpiresAt && Date.parse(e.grantExpiresAt) < now + 24 * 3600 * 1000) {
            const res = await api('POST', '/device/v2/grant/refresh', { bearer: e.grant, body: { refreshGrant: e.refreshGrant } });
            if (res.json && res.json.grant) { Object.assign(e, pick(res.json, GRANT_KEYS)); save(); }
        }
        return e;
    }

    async function anonToken(e) {
        const r = rt(e.slot);
        if (r.anon && r.anon.exp > Date.now() + 60000) return r.anon.token;
        await ensureDevice(e);
        const res = await api('POST', '/session/v1/sessions/anonymous', { bearer: e.grant, body: {} });
        if (!res.json || !res.json.accessToken) throw fail('SiriusXM did not open a session.', 'XMRADIO_SESSION', { status: res.status });
        r.anon = { token: res.json.accessToken, exp: Date.parse(res.json.accessTokenExpiresAt) || Date.now() + 3600000 };
        return r.anon.token;
    }

    async function openSession(e) {
        const r = rt(e.slot);
        await ensureDevice(e);
        // the identity grant from the sign-in, else the device grant (signed in, the device carries the identity)
        for (const bearer of [e.identityGrant, e.grant].filter(Boolean)) {
            const res = await api('POST', '/session/v1/sessions/authenticated', { bearer });
            if (res.json && res.json.accessToken) {
                r.auth = { token: res.json.accessToken, exp: Date.parse(res.json.accessTokenExpiresAt) || Date.now() + 3600000, entitlementHash: res.json.entitlementHash || '' };
                if (e.signedOut) { delete e.signedOut; e.signedIn = true; save(); }
                noteHash(e.slot, r.auth.entitlementHash);
                return r.auth.token;
            }
        }
        e.signedOut = 'expired';
        e.signedIn = false;
        noteError(e, 'The SiriusXM sign-in ended.');
        save();
        changed();
        return null;
    }

    /** The slot's access token; null when nobody is signed in on it (or SiriusXM ended the sign-in). */
    async function token(slot) {
        const n = checkSlot(slot);
        if (n === 1) return deps.slot1.token();
        const r = rt(n);
        if (deps.external()) return r.auth && r.auth.exp > Date.now() + 30000 ? r.auth.token : null;
        if (r.auth && r.auth.exp > Date.now() + 60000) return r.auth.token;
        const e = entry(n);
        // an empty slot never registers a device by being asked for a token
        if (!isSignedIn(e)) return null;
        if (!r.inflight) r.inflight = openSession(e).finally(() => { r.inflight = null; });
        return r.inflight;
    }

    /** { token, exp, entitlementHash } for the recorder service; null when not signed in. */
    async function access(slot) {
        const n = checkSlot(slot);
        if (n === 1) return deps.slot1.access();
        const t = await token(n);
        const a = rt(n).auth;
        return t && a ? { slot: n, token: a.token, exp: a.exp, entitlementHash: a.entitlementHash } : null;
    }

    /** Every slot up to the count that is signed in, with its token (the push to the recorder). */
    async function accessAll() {
        const out = [];
        for (let n = 1; n <= load().count; n++) {
            if (n > 1 && !ready(n)) continue;
            let a = null;
            try { a = await access(n); } catch (_) { a = null; }
            if (a) out.push({ ...a, slot: n });
        }
        return out;
    }

    /** The recorder service: the access token Dreamscape handed over for a slot (or clear: true to drop it). */
    function setAuth(slot, a) {
        const n = checkSlot(slot);
        if (n === 1) return deps.slot1.setAuth(a);
        const r = rt(n);
        if (a && a.clear) { r.auth = null; return false; }
        if (a && a.token) {
            r.auth = { token: String(a.token), exp: Number(a.exp) || Date.now() + 3600000, entitlementHash: a.entitlementHash || '' };
            noteHash(n, r.auth.entitlementHash);
        }
        return !!(r.auth && r.auth.token);
    }

    /** The tokens this process holds for the slots, for the recorder service's own file (slot -> { token, exp, hash }). */
    function held() {
        const out = {};
        const a1 = deps.slot1.authRaw();
        if (a1 && a1.token) out[1] = { token: a1.token, exp: a1.exp, entitlementHash: a1.entitlementHash || '' };
        for (const [n, r] of runtime) if (n > 1 && r.auth && r.auth.token) out[n] = { token: r.auth.token, exp: r.auth.exp, entitlementHash: r.auth.entitlementHash || '' };
        return out;
    }

    /** SiriusXM answered 401 on a slot's token: forget it. */
    function dropToken(slot) {
        const n = checkSlot(slot);
        if (n === 1) { deps.slot1.clear(); return; }
        rt(n).auth = null;
    }

    // -------------------------------------------------------------- sign-in and sign-out (Dreamscape only)

    /** Password sign-in of a slot (handle and password used once, never stored). Returns the slot's list entry. */
    async function signInPassword(slot, handle, password) {
        const n = checkSlot(slot);
        if (deps.external()) throw fail('Sign in from Dreamscape.', 'XMRADIO_SIGNIN');
        if (n === 1) { await deps.slot1.signIn(handle, password); return view(1); }
        const h = String(handle || '').trim();
        const pw = String(password || '');
        if (!h || !pw) throw fail('Type the email or username and the password.', 'XMRADIO_HANDLE');
        const e = entry(n);
        const r = rt(n);
        try {
            await ensureDevice(e);
            // the anonymous session's token carries the call, as on the web player
            let res = await api('POST', '/identity/v1/identities/authenticate/password', { bearer: await anonToken(e), body: { handle: h, password: pw } });
            if ((res.status === 401 || res.status === 403) && !(res.json && res.json.grant)) {
                res = await api('POST', '/identity/v1/identities/authenticate/password', { bearer: e.grant, body: { handle: h, password: pw } });
            }
            if (!res.json || !res.json.grant) {
                const why = res.json && (res.json.description || res.json.message);
                console.warn(`[xmRadio] slot ${n} password sign-in refused: ${res.status} ${(res.json && res.json.code) || ''}`);
                throw fail(res.status === 401 || res.status === 400 ? 'The email, username or password is not right.' : `SiriusXM could not sign you in${why ? `: ${why}` : '.'}`, 'XMRADIO_SIGNIN', { status: res.status });
            }
            e.identityId = res.json.identityId;
            e.identityGrant = res.json.grant;
            e.handle = h;
            e.since = Date.now();
            e.signedIn = true;
            delete e.signedOut;
            r.auth = null;
            save();
            const tok = await token(n);
            if (!tok) {
                delete e.identityId;
                delete e.identityGrant;
                e.signedIn = false;
                throw fail('SiriusXM signed you in but did not open a session.', 'XMRADIO_SESSION');
            }
            delete e.lastError;
            delete e.lastErrorAt;
            save();
        } catch (err) {
            noteError(e, err && err.message);
            save();
            changed();
            throw err;
        }
        changed();
        return view(n);
    }

    /** Sign a slot out: its sign-in and handle go, its device stays (the next sign-in reuses it). */
    function signOut(slot) {
        const n = checkSlot(slot);
        if (n === 1) { deps.slot1.signOut(); return view(1); }
        const e = entry(n);
        for (const k of ['identityId', 'identityGrant', 'handle', 'since', 'signedOut', 'lastError', 'lastErrorAt']) delete e[k];
        e.signedIn = false;
        const r = rt(n);
        r.auth = null;
        r.anon = null;
        save();
        changed();
        return view(n);
    }

    /** How many slots there are (1..8; slots above keep their account kept, hidden and not pushed to the recorder). */
    function setCount(n) {
        const v = Math.round(Number(n));
        if (!Number.isFinite(v) || v < 1 || v > MAX_SLOTS) throw fail(`The number of slots is 1 to ${MAX_SLOTS}.`, 'XMRADIO_SLOT');
        load().count = v;
        save();
        changed();
        return v;
    }

    // -------------------------------------------------------------- entitlement (learned)

    let ent = null;
    let entStamp = -1;
    function readEnt() {
        let stamp = 0;
        try { stamp = fs.statSync(entFile()).mtimeMs; } catch (_) { stamp = 0; }
        if (ent && stamp === entStamp) return ent;
        try { ent = JSON.parse(fs.readFileSync(entFile(), 'utf8')) || {}; } catch (_) { ent = {}; }
        entStamp = stamp;
        return ent;
    }
    function writeEnt(next) {
        try {
            writeAtomic(entFile(), JSON.stringify(next));
            ent = next;
            try { entStamp = fs.statSync(entFile()).mtimeMs; } catch (_) { entStamp = -1; }
        } catch (err) { console.warn(`[xmRadio] slot entitlement not saved: ${err.message}`); }
    }

    /** A slot's entitlementHash: when it differs from the one the refusals were learned under, they are cleared. */
    function noteHash(slot, hash) {
        const h = String(hash || '');
        if (!h) return;
        const cur = readEnt()[slot];
        if (cur && cur.hash === h) return;
        // a changed plan (or the first hash) starts the slot's refusals again
        writeEnt(Object.assign({}, readEnt(), { [slot]: { hash: h, refused: cur && !cur.hash ? cur.refused || [] : [] } }));
        changed();
    }

    /** tuneSource refused this channel for this slot's account. */
    function learnRefusal(slot, channelId) {
        const n = checkSlot(slot);
        const id = String(channelId || '');
        const cur = readEnt()[n] || { hash: '', refused: [] };
        if ((cur.refused || []).includes(id)) return false;
        writeEnt(Object.assign({}, readEnt(), { [n]: { hash: cur.hash || '', refused: [...(cur.refused || []), id].slice(-2000) } }));
        changed();
        return true;
    }

    /** Can this slot's account play this channel? Signed in (a token held, or a sign-in kept) and not refused. */
    function slotCanPlay(slot, channelId) {
        const n = checkSlot(slot);
        if (!ready(n)) return false;
        const cur = readEnt()[n];
        return !(cur && (cur.refused || []).includes(String(channelId || '')));
    }

    function ready(n) {
        if (n === 1) return deps.slot1.ready();
        if (deps.external()) { const a = rt(n).auth; return !!(a && a.exp > Date.now() + 30000); }
        return isSignedIn(entry(n));
    }

    // -------------------------------------------------------------- the read API (no grants, no tokens)

    function view(n) {
        const ents = readEnt()[n] || {};
        if (n === 1) {
            const s = deps.slot1.state();
            const a = deps.slot1.authRaw();
            return {
                slot: 1, name: nameOf(1), handle: s.identityId ? maskHandle(s.handle) : '', signedIn: !!s.identityId && !s.signedOut,
                since: s.signedInAt || null, tokenExp: a && a.exp ? a.exp : null,
                entitlementHash: String((a && a.entitlementHash) || ents.hash || '').slice(0, 8), refused: (ents.refused || []).length,
                lastError: s.lastError || '', lastErrorAt: s.lastErrorAt || null
            };
        }
        const e = entry(n);
        const a = rt(n).auth;
        return {
            slot: n, name: e.name || nameOf(n), handle: e.identityId ? maskHandle(e.handle) : '', signedIn: isSignedIn(e),
            since: e.since || null, tokenExp: a && a.exp ? a.exp : null,
            entitlementHash: String((a && a.entitlementHash) || ents.hash || '').slice(0, 8), refused: (ents.refused || []).length,
            lastError: e.lastError || '', lastErrorAt: e.lastErrorAt || null
        };
    }

    function list() {
        const out = [];
        for (let n = 1; n <= load().count; n++) out.push(view(n));
        return out;
    }

    return {
        MAX_SLOTS, DEFAULT_COUNT,
        count: () => load().count,
        list, view, token, access, accessAll, setAuth, held, dropToken, signInPassword, signOut, setCount,
        learnRefusal, slotCanPlay, noteHash, ready,
        reload: () => { doc = null; runtime.clear(); ent = null; entStamp = -1; },
        _entry: (n) => entry(n)
    };
}

module.exports = { create, MAX_SLOTS, DEFAULT_COUNT };
