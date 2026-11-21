/**
 * ActiveSync direct link (Yozora #1006, docs/activesync-direct-link.md): a computer tab and a phone on the same LAN talk
 * over a WebRTC data channel instead of through this server. The server only introduces them and vouches for both:
 *
 *   as_link_offer { deviceId, sdp }  (a computer tab, administrator, the phone allows files)
 *     -> the link token (ES256, bound to the device, the computer and the computer's DTLS fingerprint, 120 s)
 *     -> link.offer { sdp, token, nonce, client } to the phone, which checks the token and answers { sdp, sig }
 *     -> { sdp, sig, nonce, phoneKey, sameNetwork, expiresAt } to the computer, which checks sig with phoneKey (the
 *        phone's Key Manager certificate) before it lets the link open.
 *
 * The link key: ECDSA P-256 in ~/.secrets/dreamscape-aslink.key (PKCS#8 PEM, 0600), made on first use, never logged
 * (DREAMSCAPE_ASLINK_KEY_DIR moves it). Phones get its public half in the answer to their as_hello (linkKey).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOKEN_TTL_S = 120;
const MAX_SDP_BYTES = 64 * 1024;
const OFFER_TIMEOUT_MS = 15000;

let key = null; // { privateKey, spki (base64 DER), kid }

function keyDir() {
    return process.env.DREAMSCAPE_ASLINK_KEY_DIR || path.join(os.homedir(), '.secrets');
}

/** The server's link key, made on first use. */
function linkKey() {
    if (key) return key;
    const file = path.join(keyDir(), 'dreamscape-aslink.key');
    let privateKey = null;
    try { privateKey = crypto.createPrivateKey(fs.readFileSync(file, 'utf8')); } catch (_) { privateKey = null; }
    if (!privateKey || privateKey.asymmetricKeyType !== 'ec') {
        const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
        privateKey = pair.privateKey;
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
    const spkiDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    key = { privateKey, spki: spkiDer.toString('base64'), kid: crypto.createHash('sha256').update(spkiDer).digest('hex').slice(0, 16) };
    return key;
}

/** What a phone keeps to check tokens: { kid, spki }. */
function publicKey() {
    try { const k = linkKey(); return { kid: k.kid, spki: k.spki }; } catch (err) {
        console.warn('[activeSyncLink] link key unavailable:', err.message);
        return null;
    }
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** The SDP's DTLS certificate fingerprint (sha-256), upper-case hex with colons, or null. */
function sdpFingerprint(sdp) {
    const m = /^a=fingerprint:sha-256 ([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31})\s*$/m.exec(String(sdp || ''));
    return m ? m[1].toUpperCase() : null;
}

/** The link token (JWS compact, ES256 raw r||s). */
function mintToken({ deviceId, clientId, fingerprint, nonce, now = Date.now() }) {
    const k = linkKey();
    const iat = Math.floor(now / 1000);
    const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'aslink', kid: k.kid }));
    const payload = b64url(JSON.stringify({ v: 1, d: deviceId, c: clientId, n: nonce, fp: fingerprint, iat, exp: iat + TOKEN_TTL_S }));
    const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: k.privateKey, dsaEncoding: 'ieee-p1363' });
    return { token: `${header}.${payload}.${b64url(sig)}`, expiresAt: (iat + TOKEN_TTL_S) * 1000 };
}

/** The phone's public key (SPKI base64) from its live Key Manager certificate, or null. */
async function phoneKey(globalResources, deviceId) {
    let pem = null;
    try {
        const service = require('./clientCertificates').live(globalResources);
        pem = await service.currentPem('android', deviceId);
    } catch (err) {
        console.warn('[activeSyncLink] certificate lookup failed:', err.message);
        return null;
    }
    if (!pem) return null;
    try { return crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64'); } catch (_) { return null; }
}

// ---- same network (a hint only: both ends often reach this server through the Nightshade Network)

function ipv4ToInt(ip) {
    const p = String(ip || '').replace(/^::ffff:/i, '').split('.');
    if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
    return ((Number(p[0]) << 24) >>> 0) + (Number(p[1]) << 16) + (Number(p[2]) << 8) + Number(p[3]);
}

function inSubnet(ip, addr, prefix) {
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(addr);
    const n = Number(prefix);
    if (a == null || b == null || !(n >= 0 && n <= 32)) return false;
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

function sameNetwork(clientIp, deviceIps, net) {
    const ip = String(clientIp || '').replace(/^::ffff:/i, '');
    if (!ip) return false;
    if ((deviceIps || []).some((d) => String(d).replace(/^::ffff:/i, '') === ip)) return true;
    const ifaces = (net && Array.isArray(net.interfaces)) ? net.interfaces : [];
    return ifaces.some((i) => (i.v4 || []).some((a) => inSubnet(ip, a.addr, a.prefix)));
}

// ---- signalling

/** as_link_offer from a computer tab: the token, the phone's answer, its proof and key. */
async function offer(globalResources, wsServer, clientInfo, data) {
    const activeSync = require('./activeSync');
    const fail = (code, message) => new activeSync.AsError(code, message);
    const src = data && typeof data === 'object' ? data : {};
    const me = clientInfo && clientInfo.as;
    if (!me || me.kind !== 'computer') throw fail('NO_HELLO', 'Say as_hello as a computer first.');
    const deviceId = String(src.deviceId || '').toLowerCase();
    if (!activeSync.isPeerId(deviceId) || !activeSync.deviceRow(globalResources, deviceId)) throw fail('UNKNOWN_DEVICE', 'No such device.');
    const sdp = String(src.sdp || '');
    if (!sdp || Buffer.byteLength(sdp) > MAX_SDP_BYTES) throw fail('BAD_SDP', 'The offer is missing or too large.');
    const fingerprint = sdpFingerprint(sdp);
    if (!fingerprint) throw fail('BAD_SDP', 'The offer has no sha-256 fingerprint.');
    if (!activeSync.deviceOnline(globalResources, wsServer, deviceId)) throw fail('OFFLINE', 'The device is not connected.');
    if (!activeSync.devicePermits(globalResources, wsServer, deviceId, 'files')) throw fail('NOT_PERMITTED', 'The device does not share its files.');
    const key64 = await phoneKey(globalResources, deviceId);
    if (!key64) throw fail('NO_CERTIFICATE', 'The phone has no certificate to prove itself with yet.');
    const nonce = b64url(crypto.randomBytes(16));
    const { token, expiresAt } = mintToken({ deviceId, clientId: me.id, fingerprint, nonce });
    const res = await activeSync.serverCall(globalResources, wsServer, deviceId, 'link.offer',
        { sdp, token, nonce, client: { id: me.id, name: me.name || '' } }, { timeoutMs: OFFER_TIMEOUT_MS, fromName: me.name });
    if (!res || typeof res.sdp !== 'string' || typeof res.sig !== 'string') throw fail('BAD_ANSWER', 'The phone did not answer the link.');
    const status = activeSync.deviceStatus(globalResources, wsServer, deviceId) || {};
    return {
        success: true,
        sdp: res.sdp,
        sig: res.sig,
        nonce,
        phoneKey: key64,
        expiresAt,
        sameNetwork: sameNetwork(clientInfo.clientIP, activeSync.deviceAddresses(globalResources, wsServer, deviceId), status.net)
    };
}

// ---- the phone's networks in its status (as_status.net)

const IF_TYPES = new Set(['wifi', 'ethernet', 'cellular', 'vpn', 'usb', 'bluetooth', 'other']);
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:.]{2,45}$/i;

function sanitizeNet(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
    const addrs = (list, re, max) => (Array.isArray(list) ? list : []).slice(0, 8)
        .filter((a) => a && re.test(String(a.addr || '')) && !/^fe[89ab][0-9a-f]:/i.test(String(a.addr)))
        .map((a) => ({ addr: String(a.addr), prefix: Math.max(0, Math.min(max, Number(a.prefix) || 0)), ...(a.scope ? { scope: str(a.scope, 16) } : {}) }));
    const interfaces = (Array.isArray(raw.interfaces) ? raw.interfaces : []).slice(0, 16)
        .filter((i) => i && typeof i.name === 'string' && i.name)
        .map((i) => ({ name: str(i.name, 32), type: IF_TYPES.has(i.type) ? i.type : 'other', up: i.up === true, v4: addrs(i.v4, IPV4, 32), v6: addrs(i.v6, IPV6, 128) }));
    const routes = (Array.isArray(raw.routes) ? raw.routes : []).slice(0, 32)
        .filter((r) => r && typeof r.dst === 'string')
        .map((r) => ({ dst: str(r.dst, 64), ...(r.gw ? { gw: str(r.gw, 45) } : {}), ...(r.dev ? { dev: str(r.dev, 32) } : {}) }));
    const link = raw.link && typeof raw.link === 'object' ? { ready: raw.link.ready === true, max: Math.max(0, Math.min(16, Number(raw.link.max) || 0)) } : { ready: false, max: 0 };
    return { at: Number(raw.at) > 0 ? Number(raw.at) : Date.now(), interfaces, routes, link };
}

module.exports = { publicKey, sdpFingerprint, mintToken, offer, sanitizeNet, sameNetwork, __test: { inSubnet, linkKey, resetKey: () => { key = null; } } };
