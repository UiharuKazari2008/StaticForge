'use strict';
/**
 * Melaton Mobile Settings > System > Certificates (Yozora #805): the certificate lists the phone's
 * Manage Certificates page shows, read from what this server really trusts and serves.
 *
 *   GET /api/wm-certificates
 *     { success, personal: [], intermediate: [cert], root: [cert], host }
 *     cert = { subject, issuer, validFrom, validTo, serial, fingerprint, selfSigned }
 *
 *   root          the CA store Node uses for outgoing TLS (tls.getCACertificates('default'), else
 *                 tls.rootCertificates)
 *   intermediate  the CA certificates between the site certificate and its root in the chain the
 *                 phone's own host (the request's Host, a DNS name) serves on port 443: one TLS
 *                 handshake, nothing sent, cached 6 hours per host
 *   personal      certificates that identify this phone: there are none (no client certificates)
 */
const tls = require('tls');
const crypto = require('crypto');
const net = require('net');

const CHAIN_TTL_MS = 6 * 60 * 60 * 1000;
const CHAIN_TIMEOUT_MS = 5000;
const MAX_HOSTS = 4;
const chains = new Map(); // host -> { at, list | null, pending }
let rootCache = null;

const nameOf = (dn) => {
    const s = String(dn || '');
    const pick = (k) => { const m = s.match(new RegExp(`(?:^|\\n)${k}=([^\\n]+)`)); return m ? m[1].trim() : ''; };
    return pick('CN') || pick('OU') || pick('O') || s.split('\n')[0] || '';
};

function fromX509(x) {
    return {
        subject: nameOf(x.subject),
        issuer: nameOf(x.issuer),
        validFrom: new Date(x.validFrom).toISOString(),
        validTo: new Date(x.validTo).toISOString(),
        serial: x.serialNumber,
        fingerprint: x.fingerprint256,
        selfSigned: x.subject === x.issuer
    };
}

function roots() {
    if (rootCache) return rootCache;
    let pems = [];
    try { pems = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('default') : tls.rootCertificates; } catch (_) { pems = tls.rootCertificates; }
    const out = [];
    for (const pem of pems || []) {
        try { out.push(fromX509(new crypto.X509Certificate(pem))); } catch (_) { /* a certificate Node cannot parse */ }
    }
    rootCache = out.sort((a, b) => a.subject.localeCompare(b.subject));
    return rootCache;
}

/** The request's host when it is a DNS name worth asking (not an IP, not loopback). */
function hostOf(req) {
    const raw = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    const host = raw.replace(/:\d+$/, '');
    if (!host || net.isIP(host) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host === 'localhost' || host.endsWith('.localhost')) return null;
    return host;
}

function fetchChain(host) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (list) => { if (done) return; done = true; try { sock.destroy(); } catch (_) { /* closed */ } resolve(list); };
        const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: CHAIN_TIMEOUT_MS }, () => {
            const list = [];
            const seen = new Set();
            let c = sock.getPeerCertificate(true);
            // the leaf is the site's own certificate; what follows up to the root are the intermediates
            let depth = 0;
            while (c && c.raw && !seen.has(c.fingerprint256)) {
                seen.add(c.fingerprint256);
                if (depth > 0) {
                    try {
                        const x = new crypto.X509Certificate(c.raw);
                        if (x.subject !== x.issuer) list.push(fromX509(x));
                    } catch (_) { /* skip */ }
                }
                depth++;
                c = c.issuerCertificate;
            }
            finish(list);
        });
        sock.on('timeout', () => finish(null));
        sock.on('error', () => finish(null));
        setTimeout(() => finish(null), CHAIN_TIMEOUT_MS + 500);
    });
}

async function intermediates(host) {
    if (!host) return [];
    const e = chains.get(host);
    if (e && e.pending) return e.pending;
    if (e && Date.now() - e.at < CHAIN_TTL_MS) return e.list || [];
    const pending = fetchChain(host).then((list) => {
        chains.set(host, { at: Date.now(), list });
        while (chains.size > MAX_HOSTS) chains.delete(chains.keys().next().value);
        return list || [];
    });
    chains.set(host, { at: 0, list: null, pending });
    return pending;
}

function mount(app, authMiddleware) {
    const auth = authMiddleware || ((req, res, next) => next());
    app.get('/api/wm-certificates', auth, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const host = hostOf(req);
            res.json({ success: true, host, personal: [], intermediate: await intermediates(host), root: roots() });
        } catch (err) {
            res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
        }
    });
}

module.exports = { mount, _test: { roots, hostOf, fetchChain, nameOf } };
