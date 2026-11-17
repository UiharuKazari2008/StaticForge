/**
 * Cached logon (Yozora #899, Yukimi Nov 17 2026): an installed Melaton signs in like a domain-joined
 * Windows PC. Every PIN / password check goes through signIn():
 *
 *   - the server first (POST / {action:'login'}); when it accepts, a verifier of that password is kept
 *     on this device: PBKDF2-SHA-256, a random salt, 100 000 iterations (the scheme of the phone's own
 *     lock PIN, wmLock65.js), with the account type - never the password itself;
 *   - when the server cannot answer (no network, a timeout, a 5xx / 503 while it starts), the password is
 *     checked against that verifier: an offline logon;
 *   - a server that answers "wrong" (401 / 403) is believed: a password changed on the server stops
 *     working here as soon as the server is reachable.
 *
 * Loaded by launch.html (the BIOS boot PIN) and app.html (logon, lock, Connect, the phone's sign-in).
 *
 *   cachedLogon.signIn(pin, { headers, timeoutMs }) -> { ok, online, offline?, userType?, status?, error?, noCache? }
 *   cachedLogon.verify(pin) -> { ok, userType } | null (nothing kept)
 *   cachedLogon.has()       a verifier is kept
 *   cachedLogon.forget()    drop it (sign out of this device)
 */
(function (root) {
    'use strict';

    const KEY = 'melatonCachedLogon';
    const ITER = 100000;
    const SERVER_TIMEOUT_MS = 8000;

    const canHash = () => !!(root.crypto && root.crypto.subtle && typeof root.crypto.subtle.deriveBits === 'function');
    const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

    async function derive(pin, salt, iter) {
        const key = await root.crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
        return toB64(await root.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
    }

    function read() {
        try {
            const v = JSON.parse(root.localStorage.getItem(KEY) || 'null');
            return v && v.v === 1 && typeof v.salt === 'string' && typeof v.hash === 'string' && v.iter > 0 ? v : null;
        } catch (_) {
            return null;
        }
    }

    /** Equal-time string compare (the verifier is not secret from this device, but keep the habit). */
    function same(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
        let d = 0;
        for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return d === 0;
    }

    async function remember(pin, userType) {
        if (!canHash() || pin == null || pin === '') return false;
        try {
            const salt = root.crypto.getRandomValues(new Uint8Array(16));
            const hash = await derive(pin, salt, ITER);
            root.localStorage.setItem(KEY, JSON.stringify({ v: 1, salt: toB64(salt), iter: ITER, hash, userType: userType || null, at: Date.now() }));
            return true;
        } catch (_) {
            return false;
        }
    }

    async function verify(pin) {
        const v = read();
        if (!v || !canHash()) return null;
        try {
            const hash = await derive(pin, fromB64(v.salt), v.iter);
            return { ok: same(hash, v.hash), userType: v.userType || null };
        } catch (_) {
            return null;
        }
    }

    async function offlineLogon(pin, why) {
        const r = await verify(pin);
        if (!r) return { ok: false, online: false, noCache: true, why, error: 'The Nightshade Network is not available, and this device has not signed in before.' };
        return r.ok
            ? { ok: true, online: false, offline: true, userType: r.userType, why }
            : { ok: false, online: false, offline: true, why, error: 'The password is incorrect.' };
    }

    async function signIn(pin, opts = {}) {
        let res = null;
        let data = null;
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs || SERVER_TIMEOUT_MS) : null;
        try {
            res = await root.fetch('/', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
                body: JSON.stringify({ action: 'login', data: { pin } }),
                signal: ctl ? ctl.signal : undefined
            });
            try { data = await res.json(); } catch (_) { data = null; }
        } catch (_) {
            if (timer) clearTimeout(timer);
            return offlineLogon(pin, 'unreachable');
        }
        if (timer) clearTimeout(timer);
        if (res.ok && data && data.success) {
            await remember(pin, data.userType);
            return { ok: true, online: true, userType: data.userType || null, data };
        }
        // the server is starting or broken: it cannot say yes or no
        if (res.status >= 500) return offlineLogon(pin, 'server-error');
        return { ok: false, online: true, status: res.status, data, error: (data && (data.message || data.error)) || 'The password is incorrect.' };
    }

    root.cachedLogon = {
        signIn,
        verify,
        remember,
        has: () => !!read(),
        userType: () => { const v = read(); return v ? v.userType || null : null; },
        forget: () => { try { root.localStorage.removeItem(KEY); } catch (_) { /* private mode */ } }
    };
})(typeof window !== 'undefined' ? window : globalThis);
