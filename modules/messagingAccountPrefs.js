/**
 * Messaging's account order and account names (Yozora #978, Yukimi Nov 20 2026): "a way to manually order
 * accounts in Messaging ... the order also applies to the folders view" and "allow any account in Messaging
 * to be renamed - the account's main title (e.g. rename the 'Yukimi Kazari' email account to 'iCloud Mail')".
 *
 * One record for the user, kept on the server so the phone, the DeX window and the desktop show the same
 * (config.json messagingAccounts):
 *
 *   { order: [key, ...], names: { key: 'Account display name' } }
 *
 * Keys are Messaging's account keys: 'tm:<id>' (Text Messaging: iMessage, RCS, Android app accounts),
 * 'sms' (Dreamscape Messenger), 'mail' (Dreamscape Mail), 'imap:<id>' (an e-mail account), 'dir:<persona>'
 * (a Director persona). order lists the accounts the user placed; an account missing from it keeps its
 * place from the default order. A name is only what the account is called on screen ("Account display
 * name", as Windows Mobile's E-mail Setup has it): the address, the sign-in and the From name never change.
 *
 * A change goes to every signed-in admin page at once as msg_account_prefs { order, names } (push, no
 * polling), and the account's own module tells its clients the account changed (tm_event / ma_event
 * 'account'), so Melaton Messenger, Dovecote Express, Today and CardSpace pick the name up with the
 * account list they already read.
 */
'use strict';

const KEY_RE = /^(sms|mail|tm:[a-z0-9][a-z0-9_-]{0,31}|imap:[A-Za-z0-9_.-]{1,64}|dir:[a-z0-9_-]{1,32})$/;
const MAX_KEYS = 100;
const MAX_NAME = 60;

let gr = null;
function resources() {
    if (!gr) gr = require('./globalResources');
    return gr;
}

const cleanName = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

function cleanOrder(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const k of list) {
        const key = String(k == null ? '' : k);
        if (KEY_RE.test(key) && !out.includes(key)) out.push(key);
        if (out.length >= MAX_KEYS) break;
    }
    return out;
}

function cleanNames(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [k, v] of Object.entries(obj)) {
        const name = cleanName(v);
        if (KEY_RE.test(k) && name) out[k] = name;
        if (Object.keys(out).length >= MAX_KEYS) break;
    }
    return out;
}

/** { order, names } as stored. */
function get() {
    let b = null;
    try { b = resources().getConfig({ path: 'messagingAccounts' }); } catch (_) { b = null; }
    const block = b && typeof b === 'object' ? b : {};
    return { order: cleanOrder(block.order), names: cleanNames(block.names) };
}

/** The name the user gave the account ('' = its own name). */
function nameOf(key) { return get().names[String(key || '')] || ''; }

function push(prefs, except) {
    let server = null;
    try { server = resources().getWebSocketServer && resources().getWebSocketServer(); } catch (_) { server = null; }
    if (!server || typeof server.broadcast !== 'function') return;
    server.broadcast({ type: 'msg_account_prefs', data: prefs, timestamp: new Date().toISOString() },
        (info) => !!(info && info.authenticated && info.userType === 'admin' && info !== except));
}

/**
 * Save { order?, names? }: order replaces the stored order; names is a patch (a key with '' or null goes back
 * to the account's own name). Returns { order, names }. except: the asking socket's clientInfo (it has the
 * answer already).
 */
function save(input, except) {
    const body = input && typeof input === 'object' ? input : {};
    const was = get();
    const next = { order: was.order.slice(), names: Object.assign({}, was.names) };
    if (Array.isArray(body.order)) next.order = cleanOrder(body.order);
    const renamed = [];
    if (body.names && typeof body.names === 'object') {
        for (const [k, v] of Object.entries(body.names)) {
            if (!KEY_RE.test(k)) continue;
            const name = cleanName(v);
            if ((next.names[k] || '') === name) continue;
            if (name) next.names[k] = name; else delete next.names[k];
            renamed.push(k);
        }
    }
    const orderChanged = JSON.stringify(next.order) !== JSON.stringify(was.order);
    if (!orderChanged && !renamed.length) return was;
    resources().updateConfigValue('config', ['messagingAccounts'], next);
    push(next, except);
    // the accounts' own lists carry the name: their clients read them again
    for (const k of renamed) {
        try {
            if (k.startsWith('tm:')) require('./textMessaging').accountRenamed(k.slice(3));
            else if (k.startsWith('imap:')) require('./mailAccounts').accountRenamed(k.slice(5));
        } catch (error) { console.warn(`[messagingAccountPrefs] ${k}: ${error.message}`); }
    }
    return next;
}

/** An account was deleted: its place and name go with it. */
function forget(key) {
    const was = get();
    if (!was.order.includes(key) && !was.names[key]) return;
    const next = { order: was.order.filter((k) => k !== key), names: Object.assign({}, was.names) };
    delete next.names[key];
    try { resources().updateConfigValue('config', ['messagingAccounts'], next); push(next, null); } catch (error) { console.warn(`[messagingAccountPrefs] forget ${key}: ${error.message}`); }
}

module.exports = { get, save, nameOf, forget, KEY_RE, _setResources: (r) => { gr = r; } };
