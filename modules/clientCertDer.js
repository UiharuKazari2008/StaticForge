'use strict';
/**
 * The X.509 pieces Key Manager's client CA needs (Yozora #922, docs/client-certificates.md), in DER by hand:
 * Node reads certificates (crypto.X509Certificate) but cannot write one, a request or a CRL, and the tree
 * carries no PKI library. ECDSA P-256 with SHA-256 only.
 *
 *   parseCsr(pemOrDer)                    -> { spki, publicKey, subject } (signature checked) or throws CsrError
 *   buildCaCertificate({ ... })           -> DER
 *   buildClientCertificate({ ... })       -> DER
 *   buildCrl({ ... })                     -> DER
 *   parseCrl(der)                         -> { number, thisUpdate, nextUpdate, revoked: [{ serial, at, reason }], tbs, signature }
 *   certificateParts(der)                 -> { tbs, subjectDer, spki }
 *   pem(label, der) / fromPem(text)
 */
const crypto = require('crypto');

const OID = {
    ecPublicKey: '1.2.840.10045.2.1',
    prime256v1: '1.2.840.10045.3.1.7',
    ecdsaSha256: '1.2.840.10045.4.3.2',
    cn: '2.5.4.3',
    serialNumber: '2.5.4.5',
    o: '2.5.4.10',
    ou: '2.5.4.11',
    ski: '2.5.29.14',
    keyUsage: '2.5.29.15',
    san: '2.5.29.17',
    basicConstraints: '2.5.29.19',
    crlNumber: '2.5.29.20',
    crlReason: '2.5.29.21',
    aki: '2.5.29.35',
    eku: '2.5.29.37',
    clientAuth: '1.3.6.1.5.5.7.3.2'
};

/** CRL reason names (docs section 5) and their X.509 codes; 'revoked' is unspecified (no entry extension). */
const REASON_CODES = { revoked: 0, key_compromise: 1, superseded: 4, cessation: 5 };
const REASON_NAMES = { 0: 'revoked', 1: 'key_compromise', 4: 'superseded', 5: 'cessation' };

class CsrError extends Error {}

// ---- encoding ---------------------------------------------------------------------------------------------------

function len(n) {
    if (n < 0x80) return Buffer.from([n]);
    const bytes = [];
    while (n > 0) { bytes.unshift(n & 0xff); n = Math.floor(n / 256); }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const octets = (buf) => tlv(0x04, buf);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const bits = (buf, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), buf]));
const utf8 = (s) => tlv(0x0c, Buffer.from(String(s), 'utf8'));
const printable = (s) => tlv(0x13, Buffer.from(String(s), 'latin1'));
const explicit = (n, body) => tlv(0xa0 | n, body);

/** A non-negative INTEGER from a Buffer (big endian) or a small number. */
function int(value) {
    let buf;
    if (Buffer.isBuffer(value)) buf = value;
    else {
        const bytes = [];
        let n = Number(value);
        do { bytes.unshift(n & 0xff); n = Math.floor(n / 256); } while (n > 0);
        buf = Buffer.from(bytes);
    }
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) i++;
    buf = buf.subarray(i);
    if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
    return tlv(0x02, buf);
}

function oid(dotted) {
    const parts = dotted.split('.').map(Number);
    const out = [parts[0] * 40 + parts[1]];
    for (const p of parts.slice(2)) {
        const chunk = [p & 0x7f];
        let n = Math.floor(p / 128);
        while (n > 0) { chunk.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
        out.push(...chunk);
    }
    return tlv(0x06, Buffer.from(out));
}

/** UTCTime up to 2049, GeneralizedTime after (RFC 5280 4.1.2.5). */
function time(ms) {
    const d = new Date(ms);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const tail = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
    const y = d.getUTCFullYear();
    return y < 2050 ? tlv(0x17, Buffer.from(p(y % 100) + tail)) : tlv(0x18, Buffer.from(p(y, 4) + tail));
}

/** A Name from [[oid, text], ...], one attribute per RDN. serialNumber is a PrintableString by its definition. */
function name(pairs) {
    return seq(...pairs.map(([o, text]) => set(seq(oid(o), o === OID.serialNumber ? printable(text) : utf8(text)))));
}

const ALG_ECDSA_SHA256 = seq(oid(OID.ecdsaSha256));
const ext = (o, critical, value) => (critical ? seq(oid(o), bool(true), octets(value)) : seq(oid(o), octets(value)));

// ---- decoding ---------------------------------------------------------------------------------------------------

/** One TLV at `at`: { tag, start, bodyStart, end, body, raw }. Throws on anything malformed or indefinite. */
function read(buf, at = 0) {
    if (at + 2 > buf.length) throw new CsrError('truncated');
    const tag = buf[at];
    let l = buf[at + 1];
    let p = at + 2;
    if (l & 0x80) {
        const n = l & 0x7f;
        if (n === 0 || n > 4 || p + n > buf.length) throw new CsrError('bad length');
        l = 0;
        for (let i = 0; i < n; i++) l = l * 256 + buf[p + i];
        p += n;
    }
    if (p + l > buf.length) throw new CsrError('truncated');
    return { tag, start: at, bodyStart: p, end: p + l, body: buf.subarray(p, p + l), raw: buf.subarray(at, p + l) };
}

/** The TLVs inside a constructed value. */
function children(node) {
    const out = [];
    let at = 0;
    while (at < node.body.length) {
        const c = read(node.body, at);
        out.push(c);
        at = c.end;
    }
    return out;
}

function oidText(node) {
    if (node.tag !== 0x06 || !node.body.length) throw new CsrError('not an OID');
    const b = node.body;
    const parts = [Math.floor(b[0] / 40), b[0] % 40];
    let n = 0;
    for (let i = 1; i < b.length; i++) {
        n = n * 128 + (b[i] & 0x7f);
        if (!(b[i] & 0x80)) { parts.push(n); n = 0; }
    }
    return parts.join('.');
}

function timeMs(node) {
    const s = node.body.toString('latin1');
    const m = node.tag === 0x17 ? s.match(/^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/) : s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/);
    if (!m) throw new CsrError('bad time');
    let y = Number(m[1]);
    if (node.tag === 0x17) y += y < 50 ? 2000 : 1900;
    return Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

const intHex = (node) => {
    let b = node.body;
    while (b.length > 1 && b[0] === 0) b = b.subarray(1);
    return b.toString('hex');
};

function pem(label, der) {
    const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
    return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/** DER from PEM text (any label) or bare base64; a Buffer passes through. */
function fromPem(input) {
    if (Buffer.isBuffer(input)) return input;
    const text = String(input || '');
    const m = text.match(/-----BEGIN [A-Z0-9 ]+-----([\s\S]+?)-----END [A-Z0-9 ]+-----/);
    const b64 = (m ? m[1] : text).replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new CsrError('not PEM or base64');
    return Buffer.from(b64, 'base64');
}

// ---- requests ---------------------------------------------------------------------------------------------------

const MAX_CSR_BYTES = 4096;

/**
 * A PKCS#10 request: P-256 key, ecdsa-with-SHA256, and the signature verifies under the key in it (the proof that
 * the sender holds the private key). Anything else throws CsrError.
 */
function parseCsr(input) {
    let der;
    try { der = fromPem(input); } catch (_) { throw new CsrError('The request is not PEM or base64 DER.'); }
    if (der.length > MAX_CSR_BYTES) throw new CsrError('The request is too large.');
    let outer;
    let parts;
    let info;
    try {
        outer = read(der);
        if (outer.tag !== 0x30 || outer.end !== der.length) throw new CsrError('shape');
        parts = children(outer);
        if (parts.length !== 3 || parts[0].tag !== 0x30 || parts[1].tag !== 0x30 || parts[2].tag !== 0x03) throw new CsrError('shape');
        info = children(parts[0]);
        if (info.length < 3 || info[0].tag !== 0x02 || info[1].tag !== 0x30 || info[2].tag !== 0x30) throw new CsrError('shape');
    } catch (_) {
        throw new CsrError('The request is not a PKCS#10 certificate request.');
    }
    if (oidText(children(parts[1])[0]) !== OID.ecdsaSha256) throw new CsrError('The request must be signed with ECDSA and SHA-256.');
    const spki = Buffer.from(info[2].raw);
    let publicKey;
    try { publicKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }); } catch (_) { throw new CsrError('The public key in the request could not be read.'); }
    if (publicKey.asymmetricKeyType !== 'ec' || (publicKey.asymmetricKeyDetails || {}).namedCurve !== 'prime256v1') {
        throw new CsrError('The key must be ECDSA P-256.');
    }
    if (parts[2].body[0] !== 0) throw new CsrError('The request signature is malformed.');
    const signature = parts[2].body.subarray(1);
    let ok = false;
    try { ok = crypto.verify('sha256', parts[0].raw, { key: publicKey, dsaEncoding: 'der' }, signature); } catch (_) { ok = false; }
    if (!ok) throw new CsrError('The request signature does not match its key.');
    return { spki, publicKey, subject: Buffer.from(info[1].raw) };
}

// ---- certificates -----------------------------------------------------------------------------------------------

/** The key bits of a SubjectPublicKeyInfo, and their SHA-1 (the usual key identifier). */
function keyId(spki) {
    const bitString = children(read(spki))[1];
    return crypto.createHash('sha1').update(bitString.body.subarray(1)).digest();
}

function sign(tbs, privateKey) {
    const signature = crypto.sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
    return seq(tbs, ALG_ECDSA_SHA256, bits(signature));
}

/** tbs, subject and key of a certificate, as raw DER (the issuer name of what a CA signs must match byte for byte). */
function certificateParts(der) {
    const tbs = children(read(der))[0];
    const f = children(tbs);
    const o = f[0].tag === 0xa0 ? 1 : 0;
    return { tbs: Buffer.from(tbs.raw), subjectDer: Buffer.from(f[o + 4].raw), spki: Buffer.from(f[o + 5].raw) };
}

function tbsCertificate({ serial, issuerDer, subjectDer, notBefore, notAfter, spki, extensions }) {
    return seq(
        explicit(0, int(2)),
        int(serial),
        ALG_ECDSA_SHA256,
        issuerDer,
        seq(time(notBefore), time(notAfter)),
        subjectDer,
        spki,
        tlv(0xa3, seq(...extensions))
    );
}

/** The self-signed client CA. */
function buildCaCertificate({ privateKey, spki, serial, commonName, organization, notBefore, notAfter }) {
    const subjectDer = name([[OID.cn, commonName], [OID.o, organization]]);
    const id = keyId(spki);
    const tbs = tbsCertificate({
        serial, issuerDer: subjectDer, subjectDer, notBefore, notAfter, spki,
        extensions: [
            ext(OID.basicConstraints, true, seq(bool(true), int(0))),
            // keyCertSign (5) + cRLSign (6)
            ext(OID.keyUsage, true, bits(Buffer.from([0x06]), 1)),
            ext(OID.ski, false, octets(id))
        ]
    });
    return sign(tbs, privateKey);
}

/** A client certificate (docs/client-certificates.md section 2). `subject` = { commonName, kind, deviceId, organization }. */
function buildClientCertificate({ caPrivateKey, caDer, spki, serial, subject, notBefore, notAfter }) {
    const ca = certificateParts(caDer);
    const subjectDer = name([
        [OID.cn, subject.commonName],
        [OID.ou, subject.kind],
        [OID.o, subject.organization],
        [OID.serialNumber, subject.deviceId]
    ]);
    const uri = Buffer.from(`urn:dreamscape:device:${subject.kind}:${subject.deviceId}`, 'latin1');
    const tbs = tbsCertificate({
        serial, issuerDer: ca.subjectDer, subjectDer, notBefore, notAfter, spki,
        extensions: [
            ext(OID.basicConstraints, true, seq()),
            // digitalSignature (0)
            ext(OID.keyUsage, true, bits(Buffer.from([0x80]), 7)),
            ext(OID.eku, false, seq(oid(OID.clientAuth))),
            ext(OID.san, false, seq(tlv(0x86, uri))),
            ext(OID.ski, false, octets(keyId(spki))),
            ext(OID.aki, false, seq(tlv(0x80, keyId(ca.spki))))
        ]
    });
    return sign(tbs, caPrivateKey);
}

// ---- CRL --------------------------------------------------------------------------------------------------------

/** An X.509 v2 CRL. `revoked` = [{ serial (hex), at (ms), reason }]. */
function buildCrl({ caPrivateKey, caDer, number, thisUpdate, nextUpdate, revoked }) {
    const ca = certificateParts(caDer);
    const entries = (revoked || []).map((r) => {
        const code = REASON_CODES[r.reason] || 0;
        const fields = [int(Buffer.from(r.serial, 'hex')), time(r.at)];
        if (code) fields.push(seq(ext(OID.crlReason, false, tlv(0x0a, Buffer.from([code])))));
        return seq(...fields);
    });
    const fields = [int(1), ALG_ECDSA_SHA256, ca.subjectDer, time(thisUpdate), time(nextUpdate)];
    if (entries.length) fields.push(seq(...entries));
    fields.push(explicit(0, seq(
        ext(OID.aki, false, seq(tlv(0x80, keyId(ca.spki)))),
        ext(OID.crlNumber, false, int(number))
    )));
    return sign(seq(...fields), caPrivateKey);
}

/** Read a CRL back (the tests, and any peer that keeps a copy). The caller verifies `signature` over `tbs`. */
function parseCrl(input) {
    const der = fromPem(input);
    const outer = children(read(der));
    const tbs = outer[0];
    const f = children(tbs);
    let i = 0;
    if (f[i].tag === 0x02) i++; // version
    i += 2; // algorithm, issuer
    const thisUpdate = timeMs(f[i++]);
    const nextUpdate = (f[i] && (f[i].tag === 0x17 || f[i].tag === 0x18)) ? timeMs(f[i++]) : null;
    const revoked = [];
    if (f[i] && f[i].tag === 0x30) {
        for (const e of children(f[i++])) {
            const ef = children(e);
            let reason = 'revoked';
            if (ef[2]) {
                for (const x of children(ef[2])) {
                    const xf = children(x);
                    if (oidText(xf[0]) === OID.crlReason) reason = REASON_NAMES[read(xf[xf.length - 1].body).body[0]] || 'revoked';
                }
            }
            revoked.push({ serial: intHex(ef[0]), at: timeMs(ef[1]), reason });
        }
    }
    let number = null;
    if (f[i] && f[i].tag === 0xa0) {
        for (const x of children(children(f[i])[0])) {
            const xf = children(x);
            if (oidText(xf[0]) === OID.crlNumber) number = parseInt(intHex(read(xf[xf.length - 1].body)), 16);
        }
    }
    return { number, thisUpdate, nextUpdate, revoked, tbs: Buffer.from(tbs.raw), signature: Buffer.from(outer[2].body.subarray(1)) };
}

module.exports = {
    OID, REASON_CODES, CsrError,
    parseCsr, buildCaCertificate, buildClientCertificate, buildCrl, parseCrl, certificateParts, pem, fromPem,
    // for the tests: build a request the way a client does
    _enc: { seq, set, int, oid, utf8, bits, explicit, name, ALG_ECDSA_SHA256 }
};
