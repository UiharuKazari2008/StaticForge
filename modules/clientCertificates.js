'use strict';
/**
 * Client certificates for installed clients (Yozora #922): Key Manager's client CA. The protocol, with every
 * request and answer, is docs/client-certificates.md; this file is the server half.
 *
 *   createService({ db, caDir, settings, now })   the CA, the records, enrolment, sign-in, renewal, the CRL
 *   mount(app, authMiddleware, globalResources)   /api/client-cert/*
 *   revokeAndTell(globalResources, serial, reason, actor)   revoke + end that client's sessions and sockets
 *   live(globalResources)                         the running server's service (Key Manager's database)
 *
 * TLS ends at the proxy, so a certificate cannot ride the handshake: it signs a challenge and the server opens an
 * ordinary session for it. The CA key lives in ~/.secrets (never in the tree, never logged).
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const der = require('./clientCertDer');

const DAY_MS = 24 * 60 * 60 * 1000;
const NONCE_TTL_MS = 60 * 1000;
const MAX_NONCES = 512;
const RENEW_GAP_MS = 10 * 60 * 1000;
const ENROL_WINDOW_MS = 10 * 60 * 1000;
const ENROL_MAX = 5;
const CRL_VALID_MS = 7 * DAY_MS;
const CRL_REBUILD_MS = DAY_MS;
const CA_YEARS = 20;
const AUTH_PREFIX = 'dreamscape-client-auth-v1';
const KINDS = new Set(['android', 'dreamos']);
const REASONS = new Set(Object.keys(der.REASON_CODES));

class ClientCertError extends Error {
    constructor(status, code, message, extra) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra || null;
    }
}

const isDeviceId = (v) => typeof v === 'string' && /^[0-9a-f]{16,32}$/.test(v);
/** A device name as shown: control characters out, trimmed, at most 64 characters. */
function cleanName(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64);
}
const cleanKeyStore = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
const normalSerial = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^0-9a-f]/g, '').replace(/^0+(?=.)/, '');

/** The bytes a client signs to sign in (docs section 4.4). */
function authMessage(nonce, serial) {
    return Buffer.from(`${AUTH_PREFIX}\n${nonce}\n${serial}`, 'utf8');
}

function defaultCaDir() {
    return process.env.DREAMSCAPE_CLIENT_CA_DIR || path.join(os.homedir(), '.secrets');
}

function createService(options = {}) {
    const db = options.db;
    const caDir = options.caDir || defaultCaDir();
    const now = options.now || (() => Date.now());
    const settings = () => {
        const s = (typeof options.settings === 'function' ? options.settings() : options.settings) || {};
        const days = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
        const validityDays = days(s.validityDays, 90, 1, 825);
        return { validityDays, renewDays: Math.min(days(s.renewDays, 30, 0, 825), validityDays) };
    };

    let ca = null;
    let tables = null;
    let crlCache = null; // { number, builtAt, der, json }
    const nonces = new Map(); // nonce -> expiresAt
    const enrolTimes = new Map(); // session id -> [ms]

    function ensureTables() {
        if (!tables) {
            tables = (async () => {
                await db.exec(`CREATE TABLE IF NOT EXISTS client_certificates (
                    serial TEXT PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    device_name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    user_type TEXT NOT NULL,
                    key_store TEXT NOT NULL DEFAULT '',
                    fingerprint TEXT NOT NULL,
                    pem TEXT NOT NULL,
                    not_before INTEGER NOT NULL,
                    not_after INTEGER NOT NULL,
                    issued_at INTEGER NOT NULL,
                    issued_ip TEXT,
                    last_used_at INTEGER,
                    last_used_ip TEXT,
                    replaces_serial TEXT,
                    revoked_at INTEGER,
                    revoke_reason TEXT,
                    revoked_by TEXT
                )`);
                await db.exec('CREATE INDEX IF NOT EXISTS idx_client_cert_device ON client_certificates (kind, device_id)');
                await db.exec(`CREATE TABLE IF NOT EXISTS client_cert_sessions (
                    sid TEXT PRIMARY KEY,
                    serial TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )`);
                await db.exec('CREATE INDEX IF NOT EXISTS idx_client_cert_sessions_serial ON client_cert_sessions (serial)');
                await db.exec('CREATE TABLE IF NOT EXISTS client_cert_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
            })().catch((e) => { tables = null; throw e; });
        }
        return tables;
    }

    /** The CA, made on first use: key 0600 in caDir, certificate beside it. */
    function ensureCa() {
        if (ca) return ca;
        const keyPath = path.join(caDir, 'dreamscape-client-ca.key');
        const certPath = path.join(caDir, 'dreamscape-client-ca.crt');
        if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
            if (fs.existsSync(keyPath) !== fs.existsSync(certPath)) {
                // half a CA is never patched up: a new certificate over an old key (or the reverse) would orphan every client
                throw new Error(`Client CA is incomplete in ${caDir}: the key and the certificate must both be there, or neither.`);
            }
            fs.mkdirSync(caDir, { recursive: true, mode: 0o700 });
            const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
            const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
            const t = now();
            const certDer = der.buildCaCertificate({
                privateKey: pair.privateKey, spki, serial: newSerial(),
                commonName: 'Dreamscape Client CA', organization: 'Dreamscape',
                notBefore: t - 5 * 60 * 1000, notAfter: t + CA_YEARS * 365 * DAY_MS
            });
            fs.writeFileSync(keyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
            fs.writeFileSync(certPath, der.pem('CERTIFICATE', certDer), { mode: 0o644, flag: 'wx' });
            console.log(`🔏 Client CA created (${certPath})`);
        }
        const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
        const certPem = fs.readFileSync(certPath, 'utf8');
        const x509 = new crypto.X509Certificate(certPem);
        if (!x509.checkPrivateKey(privateKey)) throw new Error('Client CA key and certificate do not match.');
        ca = { privateKey, pem: certPem, der: Buffer.from(x509.raw), x509, publicKey: x509.publicKey };
        return ca;
    }

    /** 128 random bits, positive, no leading zero nibble: 32 hex characters, the same in every reader. */
    function newSerial() {
        const b = crypto.randomBytes(16);
        b[0] = 0x10 | (b[0] & 0x6f);
        return b;
    }

    const rowOut = (r) => (r ? {
        serial: r.serial,
        deviceId: r.device_id,
        deviceName: r.device_name,
        kind: r.kind,
        userType: r.user_type,
        keyStore: r.key_store || '',
        fingerprint: r.fingerprint,
        notBefore: r.not_before,
        notAfter: r.not_after,
        issuedAt: r.issued_at,
        issuedIp: r.issued_ip || null,
        lastUsedAt: r.last_used_at || null,
        lastUsedIp: r.last_used_ip || null,
        replacesSerial: r.replaces_serial || null,
        revokedAt: r.revoked_at || null,
        revokeReason: r.revoke_reason || null,
        revokedBy: r.revoked_by || null,
        status: r.revoked_at ? 'revoked' : (r.not_after <= now() ? 'expired' : 'issued'),
        renew: !r.revoked_at && now() > r.not_after - settings().renewDays * DAY_MS
    } : null);

    async function getRow(serial) {
        await ensureTables();
        return db.get('SELECT * FROM client_certificates WHERE serial = ?', [normalSerial(serial)]);
    }

    async function crlNumber() {
        await ensureTables();
        const row = await db.get("SELECT value FROM client_cert_meta WHERE key = 'crl_number'");
        return row ? Number(row.value) || 0 : 0;
    }

    async function issue({ csr, deviceId, deviceName, kind, keyStore, userType, ip, replacesSerial }) {
        let request;
        try { request = der.parseCsr(csr); } catch (e) {
            throw new ClientCertError(400, 'BAD_CSR', e instanceof der.CsrError ? e.message : 'The certificate request could not be read.');
        }
        const authority = ensureCa();
        const s = settings();
        const t = now();
        const serialBuf = newSerial();
        const serial = serialBuf.toString('hex');
        const notBefore = t - 5 * 60 * 1000; // a client clock a little behind still accepts it
        const notAfter = t + s.validityDays * DAY_MS;
        const certDer = der.buildClientCertificate({
            caPrivateKey: authority.privateKey, caDer: authority.der, spki: request.spki, serial: serialBuf,
            subject: { commonName: deviceName, kind, deviceId, organization: 'Dreamscape' },
            notBefore, notAfter
        });
        const certPem = der.pem('CERTIFICATE', certDer);
        const x509 = new crypto.X509Certificate(certDer);
        await db.run(`INSERT INTO client_certificates
            (serial, device_id, device_name, kind, user_type, key_store, fingerprint, pem, not_before, not_after, issued_at, issued_ip, replaces_serial)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [serial, deviceId, deviceName, kind, userType, cleanKeyStore(keyStore), x509.fingerprint256, certPem,
            notBefore, notAfter, t, ip || null, replacesSerial || null]);
        return {
            certificate: certPem, ca: authority.pem, serial, notBefore, notAfter,
            renewAfter: notAfter - s.renewDays * DAY_MS, userType, crlNumber: await crlNumber()
        };
    }

    /**
     * Enrolment after a sign-in (docs 4.2). Any live certificate of the same device is replaced at once: the person
     * just proved who they are. Returns the answer plus `revoked`: what revokeRow returned for each one replaced.
     */
    async function enrol({ csr, deviceId, deviceName, kind, keyStore, userType, ip, sessionId }) {
        await ensureTables();
        const name = cleanName(deviceName);
        if (!isDeviceId(deviceId) || !name || !KINDS.has(kind)) {
            throw new ClientCertError(400, 'BAD_DEVICE', 'deviceId (16 to 32 lowercase hex), deviceName and kind (android or dreamos) are required.');
        }
        if (sessionId) {
            const t = now();
            const times = (enrolTimes.get(sessionId) || []).filter((x) => t - x < ENROL_WINDOW_MS);
            if (times.length >= ENROL_MAX) throw new ClientCertError(429, 'TOO_MANY', 'Too many certificate requests. Try again later.');
            times.push(t);
            enrolTimes.set(sessionId, times);
            if (enrolTimes.size > 256) enrolTimes.delete(enrolTimes.keys().next().value);
        }
        const answer = await issue({ csr, deviceId, deviceName: name, kind, keyStore, userType: userType === 'readonly' ? 'readonly' : 'admin', ip });
        const old = await db.all('SELECT serial FROM client_certificates WHERE kind = ? AND device_id = ? AND serial != ? AND revoked_at IS NULL', [kind, deviceId, answer.serial]);
        const revoked = [];
        for (const o of old) {
            const r = await revokeRow(o.serial, 'superseded', 'enrolment');
            if (r) revoked.push(r);
        }
        if (sessionId) await bindSession(sessionId, answer.serial);
        answer.crlNumber = await crlNumber();
        return { answer, revoked };
    }

    /** Renewal on a certificate's own session (docs 4.5): the old one lives until the new one first signs in. */
    async function renew({ serial, csr, keyStore, ip, sessionId }) {
        const row = await getRow(serial);
        if (!row || row.revoked_at || row.not_after <= now()) {
            throw new ClientCertError(403, 'RENEW_NEEDS_CERT_SESSION', 'This session does not belong to a valid certificate.');
        }
        const latest = await db.get('SELECT MAX(issued_at) AS at FROM client_certificates WHERE kind = ? AND device_id = ? AND replaces_serial IS NOT NULL', [row.kind, row.device_id]);
        if (latest && latest.at && now() - latest.at < RENEW_GAP_MS) {
            throw new ClientCertError(429, 'TOO_MANY', 'This device renewed its certificate a moment ago.');
        }
        const answer = await issue({
            csr, deviceId: row.device_id, deviceName: row.device_name, kind: row.kind,
            keyStore: keyStore == null ? row.key_store : keyStore, userType: row.user_type, ip, replacesSerial: row.serial
        });
        if (sessionId) await bindSession(sessionId, answer.serial);
        return { answer };
    }

    function challenge() {
        const t = now();
        for (const [n, exp] of nonces) if (exp <= t) nonces.delete(n);
        while (nonces.size >= MAX_NONCES) nonces.delete(nonces.keys().next().value);
        const nonce = crypto.randomBytes(32).toString('base64url');
        nonces.set(nonce, t + NONCE_TTL_MS);
        return { nonce, expiresAt: t + NONCE_TTL_MS, serverTime: t };
    }

    /**
     * Certificate sign-in (docs 4.4). Returns { record, renew, revoked } or throws ClientCertError(401, code).
     * `revoked` lists what a first use of a renewed certificate retired.
     */
    async function authenticate({ certificate, nonce, signature, ip }) {
        const t = now();
        const exp = typeof nonce === 'string' ? nonces.get(nonce) : undefined;
        if (typeof nonce === 'string') nonces.delete(nonce);
        if (!exp || exp <= t) throw new ClientCertError(401, 'BAD_NONCE', 'The challenge is unknown, used or timed out.');
        let x509;
        try { x509 = new crypto.X509Certificate(der.fromPem(certificate)); } catch (_) {
            throw new ClientCertError(401, 'CERT_UNKNOWN', 'The certificate could not be read.');
        }
        const authority = ensureCa();
        let chained = false;
        try { chained = x509.verify(authority.publicKey); } catch (_) { chained = false; }
        const row = chained ? await getRow(x509.serialNumber) : null;
        if (!row || row.fingerprint !== x509.fingerprint256) {
            throw new ClientCertError(401, 'CERT_UNKNOWN', 'This server did not issue that certificate.');
        }
        if (row.revoked_at) {
            throw new ClientCertError(401, 'CERT_REVOKED', 'The certificate has been revoked.', { reason: row.revoke_reason || 'revoked' });
        }
        if (t >= row.not_after || t < row.not_before) throw new ClientCertError(401, 'CERT_EXPIRED', 'The certificate is outside its validity.');
        let ok = false;
        try {
            ok = crypto.verify('sha256', authMessage(nonce, row.serial), { key: x509.publicKey, dsaEncoding: 'der' }, Buffer.from(String(signature || ''), 'base64'));
        } catch (_) { ok = false; }
        if (!ok) throw new ClientCertError(401, 'BAD_SIGNATURE', 'The signature does not match the certificate.');
        await db.run('UPDATE client_certificates SET last_used_at = ?, last_used_ip = ? WHERE serial = ?', [t, ip || null, row.serial]);
        const revoked = [];
        if (row.replaces_serial) {
            const r = await revokeRow(row.replaces_serial, 'superseded', 'renewal');
            if (r) revoked.push(r);
        }
        const record = rowOut({ ...row, last_used_at: t, last_used_ip: ip || null });
        return { record, renew: record.renew, revoked };
    }

    async function bindSession(sid, serial) {
        if (!sid || !serial) return;
        await ensureTables();
        await db.run('INSERT OR REPLACE INTO client_cert_sessions (sid, serial, created_at) VALUES (?, ?, ?)', [String(sid), normalSerial(serial), now()]);
        // rows of certificates long expired are swept here, where a row is being written anyway
        await db.run('DELETE FROM client_cert_sessions WHERE serial IN (SELECT serial FROM client_certificates WHERE not_after < ?)', [now() - 30 * DAY_MS]);
    }

    async function sessionSerial(sid) {
        if (!sid) return null;
        await ensureTables();
        const row = await db.get('SELECT serial FROM client_cert_sessions WHERE sid = ?', [String(sid)]);
        return row ? row.serial : null;
    }

    async function boundSessions() {
        await ensureTables();
        return (await db.all('SELECT sid FROM client_cert_sessions')).map((r) => r.sid);
    }

    /** Mark one certificate revoked. Returns { record, sessions: [sid] }, or null when it was not live. */
    async function revokeRow(serial, reason, actor) {
        const row = await getRow(serial);
        if (!row || row.revoked_at) return null;
        const t = now();
        const why = REASONS.has(reason) ? reason : 'revoked';
        await db.run('UPDATE client_certificates SET revoked_at = ?, revoke_reason = ?, revoked_by = ? WHERE serial = ? AND revoked_at IS NULL', [t, why, actor ? String(actor).slice(0, 64) : null, row.serial]);
        const sessions = (await db.all('SELECT sid FROM client_cert_sessions WHERE serial = ?', [row.serial])).map((r) => r.sid);
        await db.run('DELETE FROM client_cert_sessions WHERE serial = ?', [row.serial]);
        const number = (await crlNumber()) + 1;
        await db.run("INSERT OR REPLACE INTO client_cert_meta (key, value) VALUES ('crl_number', ?)", [String(number)]);
        crlCache = null;
        return { record: rowOut({ ...row, revoked_at: t, revoke_reason: why, revoked_by: actor || null }), sessions, crlNumber: number };
    }

    async function revoke(serial, reason, actor) {
        const result = await revokeRow(serial, reason, actor);
        if (!result) {
            const row = await getRow(serial);
            throw new ClientCertError(row ? 409 : 404, row ? 'ALREADY_REVOKED' : 'CERT_UNKNOWN', row ? 'That certificate is already revoked.' : 'No such certificate.');
        }
        return result;
    }

    /** The CRL: revoked certificates that have not expired yet. Rebuilt when it changes, and once a day. */
    async function crl() {
        const number = await crlNumber();
        const t = now();
        if (crlCache && crlCache.number === number && t - crlCache.builtAt < CRL_REBUILD_MS) return crlCache;
        const authority = ensureCa();
        const rows = await db.all('SELECT serial, revoked_at, revoke_reason FROM client_certificates WHERE revoked_at IS NOT NULL AND not_after > ? ORDER BY revoked_at', [t]);
        const revoked = rows.map((r) => ({ serial: r.serial, revokedAt: r.revoked_at, reason: r.revoke_reason || 'revoked' }));
        const thisUpdate = Math.floor(t / 1000) * 1000;
        const nextUpdate = thisUpdate + CRL_VALID_MS;
        crlCache = {
            number, builtAt: t,
            der: der.buildCrl({
                caPrivateKey: authority.privateKey, caDer: authority.der, number, thisUpdate, nextUpdate,
                revoked: revoked.map((r) => ({ serial: r.serial, at: r.revokedAt, reason: r.reason }))
            }),
            json: { number, thisUpdate, nextUpdate, revoked }
        };
        return crlCache;
    }

    async function list() {
        await ensureTables();
        const rows = await db.all('SELECT * FROM client_certificates ORDER BY issued_at DESC LIMIT 500');
        return rows.map(rowOut);
    }

    async function get(serial) {
        return rowOut(await getRow(serial));
    }

    /** The stored certificate itself (public), for a reader that wants its fields. */
    async function certificatePem(serial) {
        const row = await getRow(serial);
        return row ? row.pem : null;
    }

    /** A device's live certificate (not revoked, not expired), PEM, or null: ActiveSync's direct link vouches with it. */
    async function currentPem(kind, deviceId) {
        await ensureTables();
        const row = await db.get('SELECT pem FROM client_certificates WHERE kind = ? AND device_id = ? AND revoked_at IS NULL AND not_after > ? ORDER BY issued_at DESC LIMIT 1',
            [String(kind || ''), String(deviceId || '').toLowerCase(), now()]);
        return row ? row.pem : null;
    }

    return {
        certificatePem, currentPem,
        ensureTables, ensureCa, caPem: () => ensureCa().pem,
        enrol, renew, challenge, authenticate, bindSession, sessionSerial, boundSessions,
        revoke, crl, crlNumber, list, get, settings
    };
}

// ---- the running server -------------------------------------------------------------------------------------------

let liveService = null;
function live(globalResources) {
    if (!liveService) {
        // the database opens later in the boot than the routes are mounted: looked up at each call
        const database = () => require('./applicationAuthDatabase').getDb();
        liveService = createService({
            db: {
                exec: (sql) => database().exec(sql),
                run: (sql, params) => database().run(sql, params),
                get: (sql, params) => database().get(sql, params),
                all: (sql, params) => database().all(sql, params)
            },
            settings: () => {
                try { return (globalResources.getConfig() || {}).clientCertificates || {}; } catch (_) { return {}; }
            }
        });
    }
    return liveService;
}

const stamp = () => new Date().toISOString();

/**
 * End what a revoked certificate opened: tell its sockets (and the Miniport carrier, natively readable), destroy
 * its sessions, then close the sockets. `result` is what revoke() returned.
 */
function endSessions(globalResources, result) {
    const sids = new Set(result.sessions || []);
    if (!sids.size) return 0;
    const message = JSON.stringify({ type: 'client_cert_revoked', data: { serial: result.record.serial, reason: result.record.revokeReason, at: result.record.revokedAt }, timestamp: stamp() });
    const closing = [];
    let wsServer = null;
    try { wsServer = globalResources.getWebSocketServer(); } catch (_) { wsServer = null; }
    if (wsServer && wsServer.clients) {
        for (const [sock, info] of wsServer.clients) {
            if (!info || !sids.has(info.sessionId)) continue;
            try { sock.send(message); } catch (_) { /* gone */ }
            closing.push([sock, 4004, 'Certificate revoked']);
        }
    }
    try {
        require('./ws/virtualSocket').forEachMiniport((carrier) => {
            if (!sids.has(carrier._dsSessionId)) return;
            try { carrier.send(message); } catch (_) { /* gone */ }
            closing.push([carrier, 1008, 'Authentication required']);
        });
    } catch (_) { /* no carriers */ }
    let store = null;
    try { store = globalResources.getSessionStore(); } catch (_) { store = null; }
    if (store && typeof store.destroy === 'function') {
        for (const sid of sids) { try { store.destroy(sid, () => {}); } catch (_) { /* gone */ } }
    }
    // the packet first, then the close: a client that reads it knows why before the socket ends
    const t = setTimeout(() => {
        for (const [sock, code, reason] of closing) { try { sock.close(code, reason); } catch (_) { /* gone */ } }
    }, 1000);
    if (typeof t.unref === 'function') t.unref();
    return closing.length;
}

/** After any change to the records: administrators' Key Manager refreshes, certificate clients learn the CRL moved. */
async function announce(globalResources, service, revokedResults) {
    let wsServer = null;
    try { wsServer = globalResources.getWebSocketServer(); } catch (_) { wsServer = null; }
    if (!wsServer || typeof wsServer.broadcast !== 'function') return;
    try { wsServer.broadcast({ type: 'client_cert_changed', data: {}, timestamp: stamp() }, (info) => !!info && info.authenticated && info.userType === 'admin' && !info.light); } catch (_) { /* nobody */ }
    const added = (revokedResults || []).map((r) => ({ serial: r.record.serial, reason: r.record.revokeReason, revokedAt: r.record.revokedAt }));
    if (!added.length) return;
    try {
        const bound = new Set(await service.boundSessions());
        if (!bound.size) return;
        const number = await service.crlNumber();
        wsServer.broadcast({ type: 'client_cert_crl', data: { number, added }, timestamp: stamp() }, (info) => !!info && bound.has(info.sessionId));
    } catch (_) { /* nobody */ }
}

/** Revoke one certificate and carry it out: sessions ended, sockets told, CRL pushed. */
async function revokeAndTell(globalResources, serial, reason, actor, service = live(globalResources)) {
    const result = await service.revoke(serial, reason, actor);
    const closed = endSessions(globalResources, result);
    await announce(globalResources, service, [result]);
    console.log(`🔏 Client certificate ${result.record.serial.slice(0, 8)}… (${result.record.deviceName}) revoked: ${result.record.revokeReason}; ${result.sessions.length} session(s), ${closed} socket(s) ended`);
    return result;
}

// ---- log off and sign out (docs/client-certificates.md section 7a) ------------------------------------------------

/**
 * Yukimi, Nov 20 2026: "on sign out it should NEVER sign out. CaféReady is cert based accounting. Sign out in the desktop
 * is just close everything and return to the login screen, and it's like a lock, not an actual server sign out. The only
 * way to sign out when using CaféReady is from the Nightshade client." The Nightshade client's Sign Out says so with this.
 */
const SIGN_OUT_INTENT = 'nightshade-signout';

/**
 * The certificate the request's session belongs to (serial), or null: a session the certificate opened (4.4) or the
 * sign-in that enrolled it (4.2), and a logon's PIN check carried over from either (web_server.js 'login').
 */
async function sessionCertificate(req, globalResources, service) {
    const s = req && req.session;
    if (!s || !s.authenticated) return null;
    if (s.authMethod === 'client_cert' && s.clientCertSerial) return normalSerial(String(s.clientCertSerial));
    try {
        return await (service || live(globalResources)).sessionSerial(s.id);
    } catch (_) {
        return null; // Key Manager's database is not open yet: nothing is bound that it could tell
    }
}

/**
 * What POST / {action:'logout'} does (web_server.js): 'keep' for a certificate's session unless the Nightshade client
 * signs out (the desktop's Log off is a lock there: the session, the certificate and the cookies stay), 'signout' for
 * that sign-out (the certificate is retired and the session ends), 'logout' for anything else (a browser's sign-out).
 */
async function logoutPlan(req, data, globalResources, service) {
    const serial = await sessionCertificate(req, globalResources, service);
    if (data && data.intent === SIGN_OUT_INTENT) return { action: 'signout', serial };
    if (serial) return { action: 'keep', serial };
    return { action: 'logout', serial: null };
}

/**
 * The Nightshade client's Sign Out on a certificate device: the certificate is revoked (cessation: this device stops
 * using the account), so its sessions end, its sockets and Miniport carrier are told (client_cert_revoked) and the app
 * forgets the key; it does not sign back in by itself (section 6 step 4). The next PIN sign-in enrols afresh.
 */
async function signOutDevice(globalResources, serial, service = live(globalResources)) {
    try {
        return await revokeAndTell(globalResources, serial, 'cessation', 'signed out on the device', service);
    } catch (e) {
        if (e instanceof ClientCertError && (e.code === 'ALREADY_REVOKED' || e.code === 'CERT_UNKNOWN')) return null;
        throw e;
    }
}

function clientIp(req, globalResources) {
    try {
        const address = require('./clientAddress');
        return address.realClientIp(req, address.trustedProxiesFromResources(globalResources)) || null;
    } catch (_) {
        return (req.socket && req.socket.remoteAddress) || null;
    }
}

/** A session a person opened: PIN (or the loopback dev login). Not an application key, token or approved-IP login. */
function personSession(req) {
    const s = req.session;
    if (!s || !s.authenticated || req.authMethod !== 'session') return false;
    if (s.approvedIpId || s.authMethod === 'approved_ip' || s.authMethod === 'client_cert') return false;
    return true;
}

function mount(app, authMiddleware, globalResources, options = {}) {
    const service = options.service || live(globalResources);
    const fail = (res, e) => {
        if (e instanceof ClientCertError) {
            res.status(e.status).json({ success: false, code: e.code, error: e.message, ...(e.extra || {}) });
            return;
        }
        console.error('client certificates:', e && e.message ? e.message : e);
        res.status(500).json({ success: false, code: 'SERVER_ERROR', error: 'The Key Manager service could not answer.' });
    };
    const after = (results) => {
        for (const r of results || []) endSessions(globalResources, r);
        return announce(globalResources, service, results);
    };
    const noStore = (res) => res.set('Cache-Control', 'no-store');

    app.get('/api/client-cert/ca', (req, res) => {
        try { res.type('application/x-pem-file').set('Cache-Control', 'no-cache').send(service.caPem()); } catch (e) { fail(res, e); }
    });

    app.get('/api/client-cert/crl', async (req, res) => {
        try {
            const c = await service.crl();
            const tag = `"crl-${c.number}"`;
            res.set('ETag', tag).set('Cache-Control', 'no-cache');
            if (req.headers['if-none-match'] === tag) { res.status(304).end(); return; }
            res.type('application/pkix-crl').send(c.der);
        } catch (e) { fail(res, e); }
    });

    app.get('/api/client-cert/crl.json', async (req, res) => {
        try { res.set('Cache-Control', 'no-cache').json((await service.crl()).json); } catch (e) { fail(res, e); }
    });

    app.post('/api/client-cert/challenge', (req, res) => {
        noStore(res);
        res.json({ success: true, ...service.challenge() });
    });

    app.post('/api/client-cert/auth', async (req, res) => {
        noStore(res);
        try {
            const body = req.body || {};
            const result = await service.authenticate({ certificate: body.certificate, nonce: body.nonce, signature: body.signature, ip: clientIp(req, globalResources) });
            if (!req.session || typeof req.session.regenerate !== 'function') throw new Error('no session support');
            await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
            req.session.authenticated = true;
            req.session.userType = result.record.userType;
            req.session.authMethod = 'client_cert';
            req.session.clientCertSerial = result.record.serial;
            await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
            await service.bindSession(req.session.id, result.record.serial);
            try {
                const siteAccess = require('./siteAccess');
                const siteCfg = siteAccess.readSiteAccessSecure(globalResources);
                if (siteCfg && siteCfg.configured && siteCfg.hash) siteAccess.setDskCookie(req, res, siteCfg.hash);
            } catch (_) { /* the gate is off */ }
            res.json({
                success: true, userType: result.record.userType, serial: result.record.serial,
                notAfter: result.record.notAfter, renew: result.renew, crlNumber: await service.crlNumber()
            });
            if (result.revoked.length) await after(result.revoked);
        } catch (e) { fail(res, e); }
    });

    app.post('/api/client-cert/enrol', authMiddleware, async (req, res) => {
        noStore(res);
        try {
            if (!personSession(req)) throw new ClientCertError(403, 'ENROL_NEEDS_SIGN_IN', 'Sign in on this device first; a certificate is issued to a signed-in session only.');
            const body = req.body || {};
            const { answer, revoked } = await service.enrol({
                csr: body.csr, deviceId: body.deviceId, deviceName: body.deviceName, kind: body.kind, keyStore: body.keyStore,
                userType: req.session.userType || 'admin', ip: clientIp(req, globalResources), sessionId: req.session.id
            });
            // the session that enrolled is this device's own: it must outlive the certificate it replaces
            for (const r of revoked) r.sessions = r.sessions.filter((sid) => sid !== req.session.id);
            console.log(`🔏 Client certificate ${answer.serial.slice(0, 8)}… issued to ${body.kind} "${cleanName(body.deviceName)}"`);
            res.json({ success: true, ...answer });
            await after(revoked);
            if (!revoked.length) await announce(globalResources, service, []);
        } catch (e) { fail(res, e); }
    });

    app.post('/api/client-cert/renew', authMiddleware, async (req, res) => {
        noStore(res);
        try {
            const s = req.session;
            // the certificate's own sessions: the ones it opened, and the sign-in that enrolled it
            const serial = s && s.authenticated && req.authMethod === 'session' ? await service.sessionSerial(s.id) : null;
            if (!serial) {
                throw new ClientCertError(403, 'RENEW_NEEDS_CERT_SESSION', 'This session does not belong to a certificate. Enrol instead.');
            }
            const body = req.body || {};
            const { answer } = await service.renew({ serial, csr: body.csr, keyStore: body.keyStore, ip: clientIp(req, globalResources), sessionId: s.id });
            console.log(`🔏 Client certificate ${answer.serial.slice(0, 8)}… issued (renewal of ${serial.slice(0, 8)}…)`);
            res.json({ success: true, ...answer });
            await announce(globalResources, service, []);
        } catch (e) { fail(res, e); }
    });

    app.get('/api/client-cert/mine', authMiddleware, async (req, res) => {
        noStore(res);
        try {
            const bound = req.session ? await service.sessionSerial(req.session.id) : null;
            // ?serial=: the certificate the device says it holds (Nightshade > Authentication), when this session
            // was opened another way (PIN, approved address); the record carries no key material
            const asked = (req.query && req.query.serial && normalSerial(String(req.query.serial))) || null;
            const serial = asked || bound;
            const record = serial ? await service.get(serial) : null;
            res.json({
                success: true,
                session: bound ? (asked && asked !== bound ? 'other' : 'certificate') : 'other',
                certificate: record ? {
                    serial: record.serial, deviceId: record.deviceId, deviceName: record.deviceName, kind: record.kind,
                    notBefore: record.notBefore, notAfter: record.notAfter, renew: record.renew, status: record.status,
                    fingerprint: record.fingerprint, issuer: 'Dreamscape Client CA', keyStore: record.keyStore,
                    userType: record.userType, issuedAt: record.issuedAt, lastUsedAt: record.lastUsedAt,
                    revokedAt: record.revokedAt, revokeReason: record.revokeReason
                } : null
            });
        } catch (e) { fail(res, e); }
    });

    return service;
}

module.exports = {
    createService, mount, live, revokeAndTell, endSessions, announce, authMessage, ClientCertError,
    SIGN_OUT_INTENT, sessionCertificate, logoutPlan, signOutDevice,
    _util: { cleanName, isDeviceId, normalSerial, personSession }
};
