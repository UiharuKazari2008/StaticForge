/**
 * Account pictures for the two MeletonFX accounts (Control Panel's User Accounts,
 * public/scripts/comp/cplUserAccounts.js; Yukimi 2026-10-13): Administrator (the admin PIN) and
 * Guest (the user PIN). Each shows one of Vista's default pictures
 * (public/static_images/account-pictures/<name>.png, from the Vista VM) or an uploaded one.
 *
 *   config.json accountPictures = { administrator: '<default name>' | 'custom', guest: ... }
 *   data/account-pictures/<account>.png     an uploaded picture (128x128 PNG, the client resizes)
 */
const fs = require('fs');
const path = require('path');

const ACCOUNTS = ['administrator', 'guest'];
const DEFAULT_PICTURES = ['music', 'starfish', 'leaf', 'robot', 'fish', 'bonsai', 'sports', 'dog', 'chess', 'kitten', 'fireworks', 'guest', 'user'];
const DEFAULTS = { administrator: 'kitten', guest: 'guest' };
const PICTURE_DIR = path.join(__dirname, '..', 'data', 'account-pictures');
const MAX_UPLOAD_BYTES = 256 * 1024;

class AccountPictureError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

function normalizeChoice(account, value) {
    if (value === 'custom') return 'custom';
    if (typeof value === 'string' && DEFAULT_PICTURES.includes(value)) return value;
    return DEFAULTS[account];
}

function customPath(account) {
    return path.join(PICTURE_DIR, `${account}.png`);
}

function readCustomDataUrl(account) {
    try {
        const buf = fs.readFileSync(customPath(account));
        return `data:image/png;base64,${buf.toString('base64')}`;
    } catch (_err) {
        return null;
    }
}

/** { administrator: { picture, url }, guest: { picture, url } } for the clients. */
function describe(config) {
    const stored = (config && config.accountPictures) || {};
    const out = {};
    for (const account of ACCOUNTS) {
        let picture = normalizeChoice(account, stored[account]);
        let url = null;
        if (picture === 'custom') {
            url = readCustomDataUrl(account);
            if (!url) picture = DEFAULTS[account];
        }
        if (!url) url = `/static_images/account-pictures/${picture}.png`;
        out[account] = { picture, url };
    }
    return out;
}

/**
 * The Administrator picture on the Vista logon screen (/status logonPicture, Use Vista Logon):
 * a default's static path, or /logon-picture for an upload. No file read, /status polls this.
 */
function logonPictureUrl(config) {
    const picture = normalizeChoice('administrator', ((config && config.accountPictures) || {}).administrator);
    return picture === 'custom' ? '/logon-picture' : `/static_images/account-pictures/${picture}.png`;
}

/**
 * Validate a change and write an uploaded picture; returns the value to store for the account.
 * dataUrl: a data:image/png;base64 URL (the client draws the upload into 128x128 first).
 */
function applyChange(account, picture, dataUrl) {
    if (!ACCOUNTS.includes(account)) throw new AccountPictureError('Unknown account', 'BAD_ACCOUNT');
    if (picture !== 'custom') {
        if (!DEFAULT_PICTURES.includes(picture)) throw new AccountPictureError('Unknown picture', 'BAD_PICTURE');
        return picture;
    }
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!match) throw new AccountPictureError('The picture must be a PNG', 'BAD_IMAGE');
    const buf = Buffer.from(match[1], 'base64');
    if (buf.length > MAX_UPLOAD_BYTES) throw new AccountPictureError('The picture is too large', 'TOO_LARGE');
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new AccountPictureError('The picture must be a PNG', 'BAD_IMAGE');
    fs.mkdirSync(PICTURE_DIR, { recursive: true });
    fs.writeFileSync(customPath(account), buf);
    return 'custom';
}

module.exports = {
    ACCOUNTS,
    DEFAULT_PICTURES,
    DEFAULTS,
    AccountPictureError,
    describe,
    applyChange,
    normalizeChoice,
    logonPictureUrl,
    customPath
};
