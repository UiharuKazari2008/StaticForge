const crypto = require('crypto');
const fs = require('fs');

/**
 * StaticForge image attestation (Ed25519).
 * Signs: RGB bytes + NUL + origin Comment UTF-8 + NUL + canonical forge_data JSON (sans forge_signed_hash).
 */

function sortKeysDeep(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    const out = {};
    for (const key of Object.keys(value).sort()) {
        out[key] = sortKeysDeep(value[key]);
    }
    return out;
}

function forgeDataForSign(forgeData) {
    const copy = { ...(forgeData && typeof forgeData === 'object' ? forgeData : {}) };
    delete copy.forge_signed_hash;
    return sortKeysDeep(copy);
}

function buildSignPayload(rgbBuffer, originCommentStr, forgeData) {
    const fdJson = JSON.stringify(forgeDataForSign(forgeData));
    return Buffer.concat([
        Buffer.isBuffer(rgbBuffer) ? rgbBuffer : Buffer.from(rgbBuffer),
        Buffer.from([0]),
        Buffer.from(originCommentStr || '', 'utf8'),
        Buffer.from([0]),
        Buffer.from(fdJson, 'utf8')
    ]);
}

function isPemKey(value) {
    return typeof value === 'string' && value.includes('BEGIN') && value.includes('END');
}

/**
 * Load forgeSigning keys from secure.config.json, or generate + persist if missing/incomplete.
 * Safe to call at startup and before every sign/verify.
 */
function ensureForgeSigningKeys(globalResources) {
    if (!globalResources || typeof globalResources.getSecureConfig !== 'function') {
        throw new Error('ensureForgeSigningKeys requires globalResources');
    }

    let privateKeyPem = globalResources.getSecureConfig({ path: 'forgeSigning.privateKey' });
    let publicKeyPem = globalResources.getSecureConfig({ path: 'forgeSigning.publicKey' });

    if (isPemKey(privateKeyPem) && isPemKey(publicKeyPem)) {
        return { privateKeyPem, publicKeyPem };
    }

    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

    const existingCreatedAt = globalResources.getSecureConfig({ path: 'forgeSigning.createdAt' });
    // Persist into secure.config.json
    // modifyConfig: modules/globalResources.js
    globalResources.modifyConfig('secureConfig').assign('forgeSigning', {
        privateKey: privateKeyPem,
        publicKey: publicKeyPem,
        createdAt: typeof existingCreatedAt === 'number' ? existingCreatedAt : Date.now()
    });

    console.log('🔐 Generated StaticForge image signing keypair (secure.config.json → forgeSigning)');
    return { privateKeyPem, publicKeyPem };
}

function signGeneratedImage(globalResources, rgbBuffer, originCommentStr, forgeData) {
    const { privateKeyPem } = ensureForgeSigningKeys(globalResources);
    const payload = buildSignPayload(rgbBuffer, originCommentStr, forgeData);
    const key = crypto.createPrivateKey(privateKeyPem);
    const sig = crypto.sign(null, payload, key);
    return sig.toString('base64');
}

function verifyGeneratedImage(globalResources, rgbBuffer, originCommentStr, forgeData, signatureB64) {
    if (!signatureB64) return false;
    const { publicKeyPem } = ensureForgeSigningKeys(globalResources);
    const payload = buildSignPayload(rgbBuffer, originCommentStr, forgeData);
    const key = crypto.createPublicKey(publicKeyPem);
    try {
        return crypto.verify(null, payload, key, Buffer.from(signatureB64, 'base64'));
    } catch (e) {
        return false;
    }
}

function getForgePublicKeyPem(globalResources) {
    const { publicKeyPem } = ensureForgeSigningKeys(globalResources);
    return publicKeyPem;
}

module.exports = {
    sortKeysDeep,
    forgeDataForSign,
    buildSignPayload,
    ensureForgeSigningKeys,
    signGeneratedImage,
    verifyGeneratedImage,
    getForgePublicKeyPem
};
