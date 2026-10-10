'use strict';

// Per-account Cursor API key, stored write-only in a 0600 file beside auth.json.
// The value is never returned; callers only get the last four characters.

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'api-key';

function sanitizeAccountId(accountId) {
    return String(accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function defaultAccountsDir(root) {
    return path.join(root || process.cwd(), '.cache', 'dreamscape-cursor-accounts');
}

function keyFile(accountId, accountsDir) {
    return path.join(accountsDir || defaultAccountsDir(), sanitizeAccountId(accountId), FILE_NAME);
}

function validKey(key) {
    const raw = String(key || '').trim();
    return /^(crsr_|sk-)[A-Za-z0-9_\-]{16,}$/.test(raw) ? raw : '';
}

function readKey(accountId, accountsDir) {
    try {
        return validKey(fs.readFileSync(keyFile(accountId, accountsDir), 'utf8'));
    } catch (_) {
        return '';
    }
}

function setKey(accountId, key, accountsDir) {
    const value = validKey(key);
    if (!value) {
        const error = new Error('Not a Cursor API key');
        error.code = 'INVALID_API_KEY';
        throw error;
    }
    const file = keyFile(accountId, accountsDir);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, value + '\n', { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
    return last4(accountId, accountsDir);
}

function clearKey(accountId, accountsDir) {
    try { fs.unlinkSync(keyFile(accountId, accountsDir)); } catch (_) { /* absent */ }
}

function last4(accountId, accountsDir) {
    const value = readKey(accountId, accountsDir);
    return value ? value.slice(-4) : '';
}

module.exports = { FILE_NAME, keyFile, readKey, setKey, clearKey, last4, validKey };
