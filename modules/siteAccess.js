'use strict';

const crypto = require('crypto');

const ACCESS_LABEL = 'ds-access:v1:';
const DSK_COOKIE = 'dsk';
const ACCESS_HEADER = 'x-dreamscape-access';
const DSK_MAX_AGE_SEC = 400 * 24 * 60 * 60;
const HASH_BYTE_LEN = 32;
/** Max characters for the cover lookup phrase (admin + door field q). */
const ACCESS_PHRASE_MAX_LEN = 512;

function normalizeAccessPhrase(raw) {
    if (raw == null) return null;
    const s = String(raw);
    if (!s || s.length > ACCESS_PHRASE_MAX_LEN) return null;
    return s;
}

function normalizeAccessHash(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s.length > 128) return null;
    return s;
}

function computeAccessHash(pepper, phrase) {
    if (!pepper || phrase == null) return null;
    const pepperBuf = Buffer.from(String(pepper), 'base64url');
    if (pepperBuf.length < 16) return null;
    return crypto.createHmac('sha256', pepperBuf)
        .update(ACCESS_LABEL + String(phrase))
        .digest('base64url');
}

function generatePepper() {
    return crypto.randomBytes(HASH_BYTE_LEN).toString('base64url');
}

function readSiteAccessSecure(globalResources) {
    const siteAccess = globalResources.getSecureConfig({ path: 'siteAccess', clone: true }) || {};
    const pepper = siteAccess.pepper;
    const hash = normalizeAccessHash(siteAccess.hash);
    const homepage = typeof siteAccess.homepage === 'string' ? siteAccess.homepage.trim() : '';
    const enabled = siteAccess.enabled !== false;
    const configured = enabled && !!pepper && !!hash && !!homepage;
    return {
        enabled,
        configured,
        pepper,
        hash,
        homepage
    };
}

function publicSiteAccessStatus(globalResources) {
    const cfg = readSiteAccessSecure(globalResources);
    return {
        configured: cfg.configured,
        homepage: cfg.configured ? cfg.homepage : null
    };
}

function hashBuffersEqual(a, b) {
    if (!a || !b) return false;
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function validateAccessToken(token, cfg) {
    const normalized = normalizeAccessHash(token);
    if (!cfg || !cfg.configured || !normalized || !cfg.hash) return false;
    return hashBuffersEqual(normalized, cfg.hash);
}

function queryParamK(req) {
    if (req.query && req.query.k != null && req.query.k !== '') {
        return normalizeAccessHash(req.query.k);
    }
    const rawUrl = req.url || req.originalUrl || '';
    const qIndex = rawUrl.indexOf('?');
    if (qIndex === -1) return null;
    try {
        const params = new URLSearchParams(rawUrl.slice(qIndex + 1));
        const k = params.get('k');
        return k ? normalizeAccessHash(k) : null;
    } catch (_err) {
        return null;
    }
}

function parseAccessTokenFromRequest(req) {
    if (!req) return null;
    const header = req.headers && req.headers[ACCESS_HEADER];
    if (header) {
        const t = normalizeAccessHash(header);
        if (t) return t;
    }
    if (req.cookies && req.cookies[DSK_COOKIE]) {
        const t = normalizeAccessHash(req.cookies[DSK_COOKIE]);
        if (t) return t;
    }
    const cookieRaw = req.headers && req.headers.cookie;
    const fromHeader = normalizeAccessHash(parseCookieHeader(cookieRaw, DSK_COOKIE));
    if (fromHeader) return fromHeader;
    return queryParamK(req);
}

function requestIsSecure(req) {
    if (req.secure === true) return true;
    const xfProto = req.headers && req.headers['x-forwarded-proto'];
    if (typeof xfProto === 'string' && xfProto.split(',')[0].trim().toLowerCase() === 'https') {
        return true;
    }
    return false;
}

function setDskCookie(req, res, hash) {
    const normalized = normalizeAccessHash(hash);
    if (!normalized) return;
    res.cookie(DSK_COOKIE, normalized, {
        httpOnly: true,
        sameSite: 'lax',
        secure: requestIsSecure(req),
        maxAge: DSK_MAX_AGE_SEC * 1000,
        path: '/'
    });
}

function clearDskCookie(res) {
    res.clearCookie(DSK_COOKIE, { path: '/' });
}

function parseCookieHeader(raw, name) {
    if (!raw || !name) return null;
    const prefix = name + '=';
    for (const part of raw.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
            try {
                return decodeURIComponent(trimmed.slice(prefix.length));
            } catch (_err) {
                return trimmed.slice(prefix.length);
            }
        }
    }
    return null;
}

function parseDskFromUpgradeRequest(req) {
    const cookies = req.headers && req.headers.cookie;
    return normalizeAccessHash(parseCookieHeader(cookies, DSK_COOKIE));
}

module.exports = {
    DSK_COOKIE,
    ACCESS_HEADER,
    DSK_MAX_AGE_SEC,
    ACCESS_PHRASE_MAX_LEN,
    normalizeAccessPhrase,
    computeAccessHash,
    generatePepper,
    readSiteAccessSecure,
    publicSiteAccessStatus,
    validateAccessToken,
    parseAccessTokenFromRequest,
    setDskCookie,
    clearDskCookie,
    parseDskFromUpgradeRequest,
    normalizeAccessHash
};
