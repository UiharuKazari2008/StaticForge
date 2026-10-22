'use strict';

const crypto = require('crypto');

const SPREV_COOKIE = 'sprev';
const TICKET_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 20 * 60 * 1000;
const SESSION_LABEL = 'site-preview-session:v1:';
const TICKET_LABEL = 'site-preview-ticket:v1:';

function previewHmacKey(globalResources) {
    const cfg = globalResources.getSecureConfig({ path: 'siteAccess', clone: true }) || {};
    if (cfg.previewKey) {
        return Buffer.from(String(cfg.previewKey), 'base64url');
    }
    if (cfg.pepper) {
        return Buffer.from(String(cfg.pepper), 'base64url');
    }
    return crypto.createHash('sha256').update('site-homepage-preview-fallback').digest();
}

function mintPreviewTicket(globalResources, slug) {
    const exp = Date.now() + TICKET_TTL_MS;
    const payload = `${slug}.${exp}`;
    const sig = crypto.createHmac('sha256', previewHmacKey(globalResources))
        .update(TICKET_LABEL + payload)
        .digest('base64url');
    return `${exp}.${sig}`;
}

function verifyPreviewTicket(globalResources, slug, token) {
    if (!token || !slug) return false;
    const parts = String(token).split('.');
    if (parts.length !== 2) return false;
    const exp = Number(parts[0]);
    const sig = parts[1];
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const payload = `${slug}.${exp}`;
    const expect = crypto.createHmac('sha256', previewHmacKey(globalResources))
        .update(TICKET_LABEL + payload)
        .digest('base64url');
    try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
    } catch (_err) {
        return false;
    }
}

function signPreviewSession(globalResources, slug) {
    const exp = Date.now() + SESSION_TTL_MS;
    const payload = `${slug}.${exp}`;
    const sig = crypto.createHmac('sha256', previewHmacKey(globalResources))
        .update(SESSION_LABEL + payload)
        .digest('base64url');
    return `${exp}.${sig}`;
}

function verifyPreviewSession(globalResources, slug, cookieVal) {
    if (!cookieVal || !slug) return false;
    const parts = String(cookieVal).split('.');
    if (parts.length !== 2) return false;
    const exp = Number(parts[0]);
    const sig = parts[1];
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const payload = `${slug}.${exp}`;
    const expect = crypto.createHmac('sha256', previewHmacKey(globalResources))
        .update(SESSION_LABEL + payload)
        .digest('base64url');
    try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
    } catch (_err) {
        return false;
    }
}

function parseSprevCookie(req) {
    if (req.cookies && req.cookies[SPREV_COOKIE]) return req.cookies[SPREV_COOKIE];
    const raw = req.headers && req.headers.cookie;
    if (!raw) return null;
    const prefix = SPREV_COOKIE + '=';
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

function setPreviewSessionCookie(req, res, globalResources, slug) {
    const val = signPreviewSession(globalResources, slug);
    const secure = req.secure === true
        || (typeof req.headers['x-forwarded-proto'] === 'string'
            && req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase() === 'https');
    res.cookie(SPREV_COOKIE, val, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: SESSION_TTL_MS,
        path: '/site-homepage-preview/'
    });
}

function requestIsAdminPreview(req) {
    return req.userType === 'admin' || (req.session && req.session.userType === 'admin');
}

function previewPathForSlug(slug, ticket) {
    return `/site-homepage-preview/${encodeURIComponent(slug)}/index.html?t=${encodeURIComponent(ticket)}`;
}

module.exports = {
    SPREV_COOKIE,
    mintPreviewTicket,
    verifyPreviewTicket,
    verifyPreviewSession,
    parseSprevCookie,
    setPreviewSessionCookie,
    requestIsAdminPreview,
    previewPathForSlug
};
