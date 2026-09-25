'use strict';

const net = require('net');

/**
 * Apocrypha / Grim client-IP resolution.
 * Fail closed. Do not reuse web_server.js getRealIP (leftmost XFF) or isPrivateIP (prefix match).
 */

const LOOPBACK_CIDRS = Object.freeze(['127.0.0.0/8', '::1']);

const DEFAULT_APOCRYPHA_ACCESS = Object.freeze({
    trustedProxies: LOOPBACK_CIDRS.slice(),
    localCidrs: LOOPBACK_CIDRS.slice(),
    localGrim: true
});

/** RFC1918 + loopback + IPv4 link-local + IPv6 ULA (fc00::/7) + IPv6 link-local. */
const PRIVATE_ULA_LINK_LOCAL_CIDRS = Object.freeze([
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '::1/128',
    'fe80::/10',
    'fc00::/7'
]);

const MAX_XFF_CHARS = 2048;
const MAX_XFF_HOPS = 32;
const UNTRUSTED_XFF_WARN_MS = 60 * 1000;
const UNTRUSTED_XFF_WARN_MAX = 64;

const untrustedXffWarnAt = new Map();

function warnUntrustedPrivateXff(peer) {
    const key = peer || 'unknown';
    const now = Date.now();
    const last = untrustedXffWarnAt.get(key) || 0;
    if (now - last < UNTRUSTED_XFF_WARN_MS) return;
    if (untrustedXffWarnAt.size >= UNTRUSTED_XFF_WARN_MAX) {
        const oldest = untrustedXffWarnAt.keys().next().value;
        untrustedXffWarnAt.delete(oldest);
    }
    untrustedXffWarnAt.set(key, now);
    console.warn('[apocrypha] untrusted private/ULA/link-local peer sent X-Forwarded-For; treating as not local:', key);
}

function resetUntrustedXffWarnings() {
    untrustedXffWarnAt.clear();
}

function isHexGroup(value) {
    return typeof value === 'string' && /^[0-9a-f]{1,4}$/i.test(value);
}

function expandIpv6(ip) {
    const lower = String(ip).toLowerCase();
    let core = lower;
    let embedded = null;
    const dotted = lower.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) {
        if (net.isIP(dotted[1]) !== 4) return null;
        const oct = dotted[1].split('.').map((n) => Number(n));
        embedded = [
            ((oct[0] << 8) | oct[1]).toString(16).padStart(4, '0'),
            ((oct[2] << 8) | oct[3]).toString(16).padStart(4, '0')
        ];
        core = lower.slice(0, -dotted[1].length);
        if (!core.endsWith(':')) return null;
    }

    let parts;
    if (core.includes('::')) {
        if (core.indexOf('::') !== core.lastIndexOf('::')) return null;
        const [head, tail] = core.split('::');
        const headParts = head ? head.split(':').filter(Boolean) : [];
        const tailParts = tail ? tail.split(':').filter(Boolean) : [];
        if (![...headParts, ...tailParts].every(isHexGroup)) return null;
        const extra = embedded ? 2 : 0;
        const missing = 8 - extra - headParts.length - tailParts.length;
        if (missing < 0) return null;
        parts = [...headParts, ...Array(missing).fill('0'), ...tailParts, ...(embedded || [])];
    } else {
        const rawParts = core.split(':').filter((p) => p !== '');
        if (!rawParts.every(isHexGroup)) return null;
        parts = embedded ? rawParts.concat(embedded) : rawParts;
    }
    if (parts.length !== 8) return null;
    return parts.map((p) => p.padStart(4, '0'));
}

function unmapIpv4Mapped(ip) {
    const groups = expandIpv6(ip);
    if (!groups) return null;
    const prefixZero = groups[0] === '0000' && groups[1] === '0000' && groups[2] === '0000'
        && groups[3] === '0000' && groups[4] === '0000';
    if (prefixZero && groups[5] === 'ffff') {
        const hi = parseInt(groups[6], 16);
        const lo = parseInt(groups[7], 16);
        return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    }
    return null;
}

/**
 * Normalize an IP: trim, drop zone id, unmap ::ffff:a.b.c.d (and hex form).
 * Returns a net.isIP string or null.
 */
function normalizeIp(value) {
    if (typeof value !== 'string') return null;
    let s = value.trim();
    if (!s) return null;
    const zone = s.indexOf('%');
    if (zone !== -1) s = s.slice(0, zone);
    if (s.startsWith('[') && s.endsWith(']')) {
        s = s.slice(1, -1);
    }
    const v4 = net.isIP(s);
    if (v4 === 4) return s;
    if (v4 === 6) {
        const mapped = unmapIpv4Mapped(s);
        return mapped || s;
    }
    return null;
}

/**
 * Strip brackets / IPv4 :port. IPv6 ports only when bracketed. Then normalize.
 */
function parseHopToken(raw) {
    if (typeof raw !== 'string') return null;
    let s = raw.trim();
    if (!s) return null;
    const zone = s.indexOf('%');
    if (zone !== -1) s = s.slice(0, zone);
    if (s.startsWith('[')) {
        const end = s.indexOf(']');
        if (end === -1) return null;
        const inside = s.slice(1, end);
        const after = s.slice(end + 1);
        if (after && !/^:\d{1,5}$/.test(after)) return null;
        return normalizeIp(inside);
    }
    const lastColon = s.lastIndexOf(':');
    if (lastColon !== -1 && s.indexOf('.') !== -1 && s.indexOf(':') === lastColon) {
        const ip = s.slice(0, lastColon);
        const port = s.slice(lastColon + 1);
        if (/^\d{1,5}$/.test(port) && net.isIP(ip) === 4) {
            return normalizeIp(ip);
        }
    }
    return normalizeIp(s);
}

function addCidr(blockList, cidr) {
    if (typeof cidr !== 'string') return false;
    const trimmed = cidr.trim();
    if (!trimmed) return false;
    const slash = trimmed.lastIndexOf('/');
    if (slash === -1) {
        const ip = normalizeIp(trimmed);
        const ver = net.isIP(ip);
        if (!ver) return false;
        blockList.addAddress(ip, ver === 4 ? 'ipv4' : 'ipv6');
        return true;
    }
    const ipPart = trimmed.slice(0, slash);
    const prefix = Number(trimmed.slice(slash + 1));
    const ip = normalizeIp(ipPart);
    const ver = net.isIP(ip);
    if (!ver || !Number.isInteger(prefix)) return false;
    const max = ver === 4 ? 32 : 128;
    if (prefix < 0 || prefix > max) return false;
    blockList.addSubnet(ip, prefix, ver === 4 ? 'ipv4' : 'ipv6');
    return true;
}

function compileCidrList(cidrs) {
    const list = new net.BlockList();
    if (!Array.isArray(cidrs)) return list;
    for (const entry of cidrs) {
        addCidr(list, entry);
    }
    return list;
}

function ipInCidrs(ip, cidrs) {
    const normalized = normalizeIp(ip);
    if (!normalized) return false;
    const list = cidrs instanceof net.BlockList ? cidrs : compileCidrList(cidrs);
    const ver = net.isIP(normalized);
    if (ver === 4) return list.check(normalized, 'ipv4');
    if (ver === 6) return list.check(normalized, 'ipv6');
    return false;
}

function isLoopbackIp(ip) {
    return ipInCidrs(ip, LOOPBACK_CIDRS);
}

function isPrivateOrLinkLocalOrUla(ip) {
    return ipInCidrs(ip, PRIVATE_ULA_LINK_LOCAL_CIDRS);
}

function readXffHeader(req) {
    const headers = req && req.headers;
    if (!headers || headers['x-forwarded-for'] == null) {
        return { present: false, tokens: [], invalid: false };
    }
    const raw = headers['x-forwarded-for'];
    const chunks = Array.isArray(raw) ? raw : [raw];
    let chars = 0;
    const tokens = [];
    for (const chunk of chunks) {
        const text = String(chunk);
        chars += text.length;
        if (chars > MAX_XFF_CHARS) {
            return { present: true, tokens: [], invalid: true };
        }
        for (const part of text.split(',')) {
            tokens.push(part);
        }
        if (tokens.length > MAX_XFF_HOPS) {
            return { present: true, tokens: [], invalid: true };
        }
    }
    return { present: true, tokens, invalid: false };
}

/**
 * Walk XFF right to left. Skip hops that are trusted proxies.
 * Any invalid token, empty list, or only-trusted hops → fail closed (client null).
 */
function clientFromXffTokens(tokens, trustedList) {
    if (!Array.isArray(tokens) || tokens.length === 0) return null;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
        const token = tokens[i];
        if (typeof token !== 'string' || token.trim() === '') return null;
        const hop = parseHopToken(token);
        if (!hop) return null;
        if (ipInCidrs(hop, trustedList)) continue;
        return hop;
    }
    return null;
}

function socketPeer(req) {
    const raw = req && req.socket ? req.socket.remoteAddress : null;
    return normalizeIp(raw);
}

/**
 * Resolve client IP for Apocrypha locality.
 * peer = req.socket.remoteAddress (normalized). Never req.ip.
 */
function resolveClientAddress(req, options) {
    const trustedProxies = options && Array.isArray(options.trustedProxies)
        ? options.trustedProxies
        : DEFAULT_APOCRYPHA_ACCESS.trustedProxies;
    const localCidrs = options && Array.isArray(options.localCidrs)
        ? options.localCidrs
        : DEFAULT_APOCRYPHA_ACCESS.localCidrs;

    const trustedList = compileCidrList(trustedProxies);
    const localList = compileCidrList(localCidrs);

    const fail = (reason, extra) => Object.assign({
        peer: extra && extra.peer != null ? extra.peer : null,
        client: extra && extra.client != null ? extra.client : null,
        local: false,
        trustedPeer: extra && extra.trustedPeer === true,
        reason
    }, extra && extra.xffPresent != null ? { xffPresent: extra.xffPresent } : {});

    const peer = socketPeer(req);
    if (!peer) {
        return fail('missing-peer');
    }

    const xff = readXffHeader(req);
    const trustedPeer = ipInCidrs(peer, trustedList);

    if (!trustedPeer) {
        if (xff.present && isPrivateOrLinkLocalOrUla(peer)) {
            warnUntrustedPrivateXff(peer);
            return fail('untrusted-private-xff', { peer, client: peer, trustedPeer: false, xffPresent: true });
        }
        return {
            peer,
            client: peer,
            local: ipInCidrs(peer, localList),
            trustedPeer: false,
            reason: 'direct-peer',
            xffPresent: xff.present
        };
    }

    if (!xff.present) {
        if (isLoopbackIp(peer)) {
            return {
                peer,
                client: peer,
                local: ipInCidrs(peer, localList),
                trustedPeer: true,
                reason: 'loopback-direct',
                xffPresent: false
            };
        }
        return fail('trusted-proxy-missing-xff', { peer, trustedPeer: true, xffPresent: false });
    }

    if (xff.invalid) {
        return fail('xff-invalid', { peer, trustedPeer: true, xffPresent: true });
    }

    const client = clientFromXffTokens(xff.tokens, trustedList);
    if (!client) {
        return fail('xff-unresolved', { peer, trustedPeer: true, xffPresent: true });
    }

    return {
        peer,
        client,
        local: ipInCidrs(client, localList),
        trustedPeer: true,
        reason: 'xff-client',
        xffPresent: true
    };
}

function asStringList(value, fallback) {
    if (!Array.isArray(value)) return fallback.slice();
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (!trimmed) continue;
        out.push(trimmed);
    }
    return out;
}

function normalizeApocryphaAccessConfig(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const trustedMissing = !Object.prototype.hasOwnProperty.call(src, 'trustedProxies');
    const localMissing = !Object.prototype.hasOwnProperty.call(src, 'localCidrs');
    const trustedProxies = trustedMissing
        ? DEFAULT_APOCRYPHA_ACCESS.trustedProxies.slice()
        : asStringList(src.trustedProxies, []);
    const localCidrs = localMissing
        ? DEFAULT_APOCRYPHA_ACCESS.localCidrs.slice()
        : asStringList(src.localCidrs, []);
    let localGrim = DEFAULT_APOCRYPHA_ACCESS.localGrim;
    if (Object.prototype.hasOwnProperty.call(src, 'localGrim')) {
        localGrim = src.localGrim === true;
    }
    return { trustedProxies, localCidrs, localGrim };
}

function resolveApocryphaAccess(req, rawConfig) {
    const config = normalizeApocryphaAccessConfig(rawConfig);
    const resolved = resolveClientAddress(req, config);
    return Object.assign({ config }, resolved);
}

function shouldShowGrim({ loggedInSession, local, localGrim }) {
    return loggedInSession === true || (localGrim === true && local === true);
}

function applyGrimCacheHeaders(res) {
    if (!res) return;
    if (typeof res.setHeader === 'function') {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Vary', 'Cookie, X-Forwarded-For');
        return;
    }
    if (typeof res.set === 'function') {
        res.set('Cache-Control', 'private, no-store');
        res.set('Vary', 'Cookie, X-Forwarded-For');
    }
}

module.exports = {
    LOOPBACK_CIDRS,
    DEFAULT_APOCRYPHA_ACCESS,
    PRIVATE_ULA_LINK_LOCAL_CIDRS,
    MAX_XFF_CHARS,
    MAX_XFF_HOPS,
    normalizeIp,
    parseHopToken,
    ipInCidrs,
    isLoopbackIp,
    isPrivateOrLinkLocalOrUla,
    resolveClientAddress,
    resolveApocryphaAccess,
    normalizeApocryphaAccessConfig,
    shouldShowGrim,
    applyGrimCacheHeaders,
    resetUntrustedXffWarnings
};
