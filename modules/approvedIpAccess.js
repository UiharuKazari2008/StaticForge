'use strict';

const crypto = require('crypto');
const {
    parseCidr,
    ipInCidrs,
    resolveRequestClientIp,
    trustedProxiesFromResources
} = require('./clientAddress');

/**
 * Web UI approved IPs. A request is signed in only when its real client IP
 * (socket peer, or XFF walked from a trusted proxy) matches an enabled CIDR.
 * Loopback is not implied. An empty list matches nothing. Disabled rows never match.
 * Login keys are read from headers only; query-string copies are rejected.
 */

const MAX_APPROVED_IPS = 64;
const MAX_LABEL_LENGTH = 80;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const FORBIDDEN_QUERY_KEYS = new Set(['loginkey', 'x-dreamscape-login-key']);

function cleanLabel(value) {
    const label = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!label || label.length > MAX_LABEL_LENGTH) return null;
    return label;
}

function cleanUserType(value) {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (raw === 'admin' || raw === 'administrator') return 'admin';
    if (raw === 'readonly' || raw === 'user') return 'readonly';
    return null;
}

function cleanEnabled(value) {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function cleanId(value) {
    if (value == null || value === '') return null;
    const id = String(value).trim();
    if (!ID_RE.test(id)) return null;
    return id;
}

function canonicalCidrOrNull(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 80) return null;
    const parsed = parseCidr(trimmed);
    if (!parsed) return null;
    return `${parsed.ip}/${parsed.prefix}`;
}

/**
 * Validate an admin save. Invalid rows reject the whole list.
 * Stored rows are canonical: id, label, cidr, enabled boolean, userType.
 */
function normalizeApprovedIpEntries(input) {
    if (input == null) return { ok: true, entries: [] };
    if (!Array.isArray(input)) {
        return { ok: false, error: 'Approved IPs must be a list', entries: [] };
    }
    if (input.length > MAX_APPROVED_IPS) {
        return { ok: false, error: `At most ${MAX_APPROVED_IPS} approved IPs`, entries: [] };
    }
    const entries = [];
    const seenCidr = new Set();
    const seenId = new Set();
    for (const raw of input) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { ok: false, error: 'Each approved IP must be an object', entries: [] };
        }
        const label = cleanLabel(raw.label);
        if (!label) {
            return { ok: false, error: 'Each approved IP needs a label (1–80 characters)', entries: [] };
        }
        const cidr = canonicalCidrOrNull(raw.cidr);
        if (!cidr) {
            return { ok: false, error: 'Invalid approved IP CIDR', entries: [] };
        }
        if (seenCidr.has(cidr)) {
            return { ok: false, error: `Duplicate approved CIDR: ${cidr}`, entries: [] };
        }
        const userType = cleanUserType(raw.userType != null ? raw.userType : raw.signInAs);
        if (!userType) {
            return { ok: false, error: 'Sign-in account must be Administrator or User', entries: [] };
        }
        let id = cleanId(raw.id);
        if (raw.id != null && raw.id !== '' && !id) {
            return { ok: false, error: 'Invalid approved IP id', entries: [] };
        }
        if (!id) id = crypto.randomBytes(8).toString('hex');
        if (seenId.has(id)) {
            return { ok: false, error: 'Duplicate approved IP id', entries: [] };
        }
        seenCidr.add(cidr);
        seenId.add(id);
        entries.push({
            id,
            label,
            cidr,
            enabled: cleanEnabled(raw.enabled),
            userType
        });
    }
    return { ok: true, entries };
}

/** Fail closed. Skips disabled, invalid, and unknown account rows. */
function usableApprovedIpEntries(input) {
    if (!Array.isArray(input)) return [];
    const usable = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object') continue;
        if (!cleanEnabled(raw.enabled)) continue;
        const cidr = canonicalCidrOrNull(raw.cidr);
        const userType = cleanUserType(raw.userType);
        const label = cleanLabel(raw.label) || 'Approved IP';
        const id = cleanId(raw.id) || '';
        if (!cidr || !userType) continue;
        usable.push({ id, label, cidr, enabled: true, userType });
    }
    return usable;
}

/**
 * First enabled match wins. Empty list, disabled rows, and loopback (unless listed) do not match.
 */
function matchApprovedIp(entries, clientIp) {
    if (typeof clientIp !== 'string' || !clientIp || clientIp === 'unknown') return null;
    for (const entry of usableApprovedIpEntries(entries)) {
        if (ipInCidrs(clientIp, [entry.cidr])) return entry;
    }
    return null;
}

function loadApprovedIpEntries(globalResources) {
    try {
        if (!globalResources || typeof globalResources.getConfig !== 'function') return [];
        const raw = globalResources.getConfig({ path: 'approvedIps' });
        return Array.isArray(raw) ? raw : [];
    } catch (_err) {
        return [];
    }
}

/**
 * Real client only. keylessIp is null when a trusted proxy did not yield a client,
 * so a missing or spoofed XFF cannot match the proxy's own address.
 */
function identifyApprovedClient(req, globalResources) {
    const info = resolveRequestClientIp(req, trustedProxiesFromResources(globalResources));
    return {
        ip: info.keylessIp || null,
        peer: info.peer || null,
        reason: info.reason,
        trustedPeer: info.trustedPeer === true
    };
}

function auditWebLogin(globalResources, record) {
    const user = record && (record.user === 'readonly' || record.user === 'admin') ? record.user : 'admin';
    const entry = {
        event: String((record && record.event) || 'login').slice(0, 40),
        ip: String((record && record.ip) || '').slice(0, 80),
        userAgent: String((record && record.userAgent) || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        user,
        at: new Date().toISOString(),
        label: String((record && record.label) || '').slice(0, MAX_LABEL_LENGTH),
        entryId: String((record && record.entryId) || '').slice(0, 40),
        source: String((record && record.source) || '').slice(0, 40)
    };
    console.log(
        `🔐 ${entry.event} user=${entry.user} ip=${entry.ip || '-'} ua=${JSON.stringify(entry.userAgent)} label=${entry.label || '-'} source=${entry.source || '-'}`
    );
    if (globalResources && Array.isArray(globalResources.authAuditLog)) {
        globalResources.authAuditLog.push(entry);
    }
    try {
        const telemetry = globalResources && typeof globalResources.getTelemetryDatabase === 'function'
            ? globalResources.getTelemetryDatabase()
            : null;
        if (telemetry && typeof telemetry.recordTelemetryEvent === 'function') {
            telemetry.recordTelemetryEvent({
                eventType: 'login',
                ip: entry.ip,
                userAgent: entry.userAgent || null,
                userType: entry.user,
                route: entry.event,
                payload: {
                    source: entry.source,
                    label: entry.label,
                    entryId: entry.entryId
                }
            }).catch(() => {});
        }
    } catch (_err) {
        // Telemetry is optional. The console line is the audit.
    }
    return entry;
}

function requestUserAgent(req) {
    const headers = req && req.headers;
    return headers && typeof headers['user-agent'] === 'string' ? headers['user-agent'] : '';
}

/**
 * Sign the session in when the real client IP matches. Does not replace an
 * existing authenticated session. Returns without a session when nothing matches.
 */
function applyApprovedIpLogin(req, globalResources) {
    if (!req || !req.session || req.session.authenticated === true) {
        return { applied: false };
    }
    const identified = identifyApprovedClient(req, globalResources);
    if (identified.ip) req.realClientIp = identified.ip;
    const entry = matchApprovedIp(loadApprovedIpEntries(globalResources), identified.ip);
    if (!entry) return { applied: false, ip: identified.ip, peer: identified.peer };
    req.session.authenticated = true;
    req.session.userType = entry.userType;
    req.session.approvedIpId = entry.id;
    req.session.authMethod = 'approved_ip';
    req.userType = entry.userType;
    req.authMethod = 'approved_ip';
    const audit = auditWebLogin(globalResources, {
        event: 'approved_ip',
        ip: identified.ip,
        userAgent: requestUserAgent(req),
        user: entry.userType,
        label: entry.label,
        entryId: entry.id,
        source: 'approved_ip'
    });
    return { applied: true, entry, ip: identified.ip, audit };
}

function createApprovedIpAutoLoginMiddleware(globalResources) {
    return function approvedIpAutoLogin(req, res, next) {
        try {
            applyApprovedIpLogin(req, globalResources);
        } catch (err) {
            console.error('Approved IP login error:', err.message);
        }
        next();
    };
}

function queryCarriesLoginKey(req) {
    const query = req && req.query;
    if (!query || typeof query !== 'object') return false;
    for (const key of Object.keys(query)) {
        if (!FORBIDDEN_QUERY_KEYS.has(String(key).toLowerCase())) continue;
        if (query[key] != null) return true;
    }
    return false;
}

function bearerToken(header) {
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return match ? match[1] : null;
}

/**
 * Header login key only. Never reads the query string.
 * X-Dreamscape-Login-Key wins over Authorization when both are present.
 */
function readHeaderLoginKey(req) {
    const headers = req && req.headers ? req.headers : {};
    const dedicated = headers['x-dreamscape-login-key'];
    if (Array.isArray(dedicated)) return { token: null, invalid: true };
    if (typeof dedicated === 'string' && dedicated.trim()) {
        return { token: dedicated.trim(), source: 'x-dreamscape-login-key', invalid: false };
    }
    const authorization = headers.authorization;
    if (Array.isArray(authorization)) return { token: null, invalid: true };
    const bearer = bearerToken(authorization);
    if (bearer) return { token: bearer, source: 'bearer', invalid: false };
    return { token: null, source: '', invalid: false };
}

function describeClientForAudit(req, globalResources) {
    const identified = identifyApprovedClient(req, globalResources);
    return {
        ip: identified.ip || identified.peer || '',
        client: identified.ip,
        peer: identified.peer
    };
}

module.exports = {
    MAX_APPROVED_IPS,
    normalizeApprovedIpEntries,
    usableApprovedIpEntries,
    matchApprovedIp,
    loadApprovedIpEntries,
    identifyApprovedClient,
    applyApprovedIpLogin,
    createApprovedIpAutoLoginMiddleware,
    queryCarriesLoginKey,
    readHeaderLoginKey,
    auditWebLogin,
    describeClientForAudit
};
