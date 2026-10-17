/**
 * Serve the Vista sound pack from public/sounds/vista (gitignored: Microsoft WAVs are not
 * committed to this public repo). Only the whitelist is reachable; whitelisted files on disk
 * are in the install manifest (web_server.js generateCacheData).
 */
const fs = require('fs');
const path = require('path');

const PACK_DIR = path.join('public', 'sounds', 'vista');

const ALLOWED_FILES = [
    'Windows Balloon.wav',
    'Windows Critical Stop.wav',
    'Windows Default.wav',
    'Windows Ding.wav',
    'Windows Error.wav',
    'Windows Exclamation.wav',
    'Windows Hardware Fail.wav',
    'Windows Logoff Sound.wav',
    'Windows Logon Sound.wav',
    'Windows Navigation Start.wav',
    'Windows Notify.wav',
    'Windows Print complete.wav',
    'Windows Recycle.wav',
    'Windows Shutdown.wav',
    'Windows User Account Control.wav'
];

const ALLOWED = new Set(ALLOWED_FILES);

function decodeSoundName(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    let name = raw;
    try {
        name = decodeURIComponent(raw);
    } catch (_err) {
        return null;
    }
    if (name !== path.basename(name) || name.includes('\0') || name.includes('/') || name.includes('\\')) {
        return null;
    }
    return ALLOWED.has(name) ? name : null;
}

function resolveSoundPath(projectRoot, filename) {
    const name = decodeSoundName(filename);
    if (!name) return null;
    const packRoot = path.resolve(projectRoot, PACK_DIR);
    const full = path.resolve(packRoot, name);
    if (full !== path.join(packRoot, name)) return null;
    return full;
}

function sendSound(req, res, projectRoot) {
    const full = resolveSoundPath(projectRoot, req.params && req.params.file);
    if (!full) {
        res.status(404).end();
        return false;
    }
    if (!fs.existsSync(full)) {
        res.status(404).end();
        return false;
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(full);
    return true;
}

module.exports = {
    PACK_DIR,
    ALLOWED_FILES,
    decodeSoundName,
    resolveSoundPath,
    sendSound
};
