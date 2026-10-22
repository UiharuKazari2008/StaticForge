'use strict';

// PIN verification and hashing, shared by every place that checks a login PIN
// (web_server.js login, mcpOAuthConsent.js, and the admin PIN set-handlers).
//
// Stored PINs are migrated from plaintext to a salted scrypt hash. verifyPin() accepts BOTH
// formats so an existing plaintext PIN in secure.config.json keeps working until it is
// upgraded (opportunistically on the next successful login, or when re-set in the UI).
//
// Hash format: "scrypt$<N>$<saltB64>$<hashB64>"   (N = cost parameter, keylen 32)

const crypto = require('crypto');

const SCRYPT_N = 16384;      // CPU/memory cost
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 32;
const PREFIX = 'scrypt$';

function isHashed(stored) {
    return typeof stored === 'string' && stored.startsWith(PREFIX);
}

function hashPin(pin) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(pin), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
    return `${PREFIX}${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Constant-time compare for the plaintext (legacy) path. Always hashes both sides to a fixed
// length first so the comparison time does not leak the stored PIN's length.
function plaintextMatch(presented, stored) {
    const a = crypto.createHash('sha256').update(String(presented)).digest();
    const b = crypto.createHash('sha256').update(String(stored)).digest();
    return crypto.timingSafeEqual(a, b);
}

function verifyScrypt(presented, stored) {
    try {
        const parts = stored.split('$'); // ['scrypt', N, salt, hash]
        const N = parseInt(parts[1], 10);
        const salt = Buffer.from(parts[2], 'base64');
        const expected = Buffer.from(parts[3], 'base64');
        const actual = crypto.scryptSync(String(presented), salt, expected.length, { N, r: SCRYPT_r, p: SCRYPT_p });
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (_) {
        return false;
    }
}

// Verify a presented PIN against the stored value (plaintext or scrypt). Returns false for an
// empty/missing stored value without a short-circuit that would leak that it is unset.
function verifyPin(presented, stored) {
    if (typeof stored !== 'string' || stored.length === 0) {
        // Still do a dummy hash so timing does not reveal "no PIN configured".
        crypto.createHash('sha256').update(String(presented)).digest();
        return false;
    }
    if (isHashed(stored)) return verifyScrypt(presented, stored);
    return plaintextMatch(presented, stored);
}

function isPinConfigured(stored) {
    return typeof stored === 'string' && stored.length > 0;
}

module.exports = { hashPin, verifyPin, isHashed, isPinConfigured };
