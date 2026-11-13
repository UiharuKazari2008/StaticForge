/**
 * IMAP e-mail accounts (Yozora #789): the server is the mail client. Every Dreamscape client (phone
 * Messaging, Dovecote Express, Search Phone, Messaging Bridge) reads and writes through it.
 *
 * Config (config.json mailAccounts.accounts[]):
 *   { id, email, displayName, imap: { host, port, security: 'tls'|'starttls'|'none', user, allowSelfSigned },
 *     smtp: { host, port, security, user }, enabled, settings: { notify, saveSent: 'auto'|'always'|'never' } }
 * Secrets (secure.config.json mailAccounts.keys[]): { name: id, password, smtpPassword? }
 *
 * The copy (mailAccountsStore.js) is filled by a sync worker process (mailAccountsSyncWorker.js) every
 * 10 minutes and on demand; new mail in the Inbox arrives by IDLE on a connection the server keeps,
 * is fetched at once and announced (ma_event 'new', notify per the account's settings). The mail
 * server wins every conflict: flags, moves and deletes go to it first, then into the copy.
 *
 * Events (ws ma_event, admins): { event: 'new'|'flags'|'removed'|'folders'|'account'|'sync', accountId, folder, uids?, message?, notify? }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { randomUUID } = require('crypto');
const store = require('./mailAccountsStore');
const imap = require('./mailAccountsImap');

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SYNC_EVERY_MS = 10 * 60 * 1000;
const OPS_IDLE_MS = 2 * 60 * 1000;

// Known providers: the form fills these in from the address (app passwords for Gmail, iCloud, Yahoo, Outlook)
const PRESETS = [
    { id: 'gmail', name: 'Gmail', domains: ['gmail.com', 'googlemail.com'], imap: { host: 'imap.gmail.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' }, autoSent: true, note: 'Use an app password (Google Account > Security > App passwords).' },
    { id: 'icloud', name: 'iCloud Mail', domains: ['icloud.com', 'me.com', 'mac.com'], imap: { host: 'imap.mail.me.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' }, userIsLocalPart: false, note: 'Use an app-specific password (appleid.apple.com).' },
    { id: 'outlook', name: 'Outlook.com', domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'], imap: { host: 'outlook.office365.com', port: 993, security: 'tls' }, smtp: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' }, autoSent: true, note: 'Use an app password if two-step verification is on.' },
    { id: 'yahoo', name: 'Yahoo Mail', domains: ['yahoo.com', 'ymail.com', 'rocketmail.com'], imap: { host: 'imap.mail.yahoo.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'tls' }, note: 'Use an app password (Account security > Generate app password).' },
    { id: 'fastmail', name: 'Fastmail', domains: ['fastmail.com', 'fastmail.fm'], imap: { host: 'imap.fastmail.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.fastmail.com', port: 465, security: 'tls' }, note: 'Use an app password (Settings > Privacy & Security).' },
    { id: 'aol', name: 'AOL Mail', domains: ['aol.com'], imap: { host: 'imap.aol.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.aol.com', port: 465, security: 'tls' }, note: 'Use an app password.' }
];

let gr = null;
let started = false;
const runtimes = new Map(); // id -> { account, status, error, watch, ops, opsTimer, syncChild, syncProgress, timer, lastPush }
const uploads = new Map();  // uploadId -> { file, name, type, size, at }

function resources() { if (!gr) gr = require('./globalResources'); return gr; }
function log(m) { console.log(`[mailAccounts] ${m}`); }
function cacheDir() { try { return resources().getPath('cache'); } catch (_) { return path.join(__dirname, '..', '.cache'); } }
function fail(code, message) { return Object.assign(new Error(message), { code }); }

// ---- config ----

function readConfig() {
    let b = null;
    try { b = resources().getConfig({ path: 'mailAccounts' }); } catch (_) { b = null; }
    const accounts = b && Array.isArray(b.accounts) ? b.accounts.filter((a) => a && ID_RE.test(String(a.id || ''))) : [];
    return { accounts };
}
function writeConfig(cfg) { resources().updateConfigValue('config', ['mailAccounts'], { accounts: cfg.accounts }); }
function secrets() { let b = null; try { b = resources().getSecureConfig({ path: 'mailAccounts' }); } catch (_) { b = null; } return b && Array.isArray(b.keys) ? b.keys : []; }
function secretFor(id) { return secrets().find((k) => k && k.name === id) || {}; }
function writeSecret(id, patch) {
    const keys = secrets().map((k) => Object.assign({}, k));
    const at = keys.findIndex((k) => k.name === id);
    if (patch === null) { if (at >= 0) keys.splice(at, 1); } else if (at >= 0) Object.assign(keys[at], patch); else keys.push(Object.assign({ name: id }, patch));
    resources().updateConfigValue('secureConfig', ['mailAccounts'], { keys });
}
function presetFor(email) {
    const domain = String(email || '').split('@')[1] || '';
    return PRESETS.find((p) => p.domains.includes(domain.toLowerCase())) || null;
}

// ---- events ----

function broadcast(payload) {
    let server = null;
    try { server = resources().getWebSocketServer && resources().getWebSocketServer(); } catch (_) { server = null; }
    if (server && typeof server.broadcast === 'function') {
        server.broadcast({ type: 'ma_event', data: payload, timestamp: new Date().toISOString() }, (info) => !!(info && info.authenticated && info.userType === 'admin'));
    }
}

// ---- runtime per account ----

function setStatus(rt, status, error) {
    const changed = rt.status !== status || (error || '') !== rt.error;
    rt.status = status;
    rt.error = error || '';
    if (changed) broadcast({ event: 'account', accountId: rt.account.id });
}

async function opsClient(rt) {
    clearTimeout(rt.opsTimer);
    rt.opsTimer = setTimeout(() => { const c = rt.ops; rt.ops = null; if (c) c.logout().catch(() => {}); }, OPS_IDLE_MS);
    if (rt.opsTimer.unref) rt.opsTimer.unref();
    if (rt.ops && rt.ops.usable) return rt.ops;
    const c = imap.client(rt.account, secretFor(rt.account.id).password || '');
    c.on('error', () => {});
    c.on('close', () => { if (rt.ops === c) rt.ops = null; });
    await c.connect();
    rt.ops = c;
    return c;
}

/** The IDLE connection on the Inbox: new mail is fetched as it arrives. */
async function startWatch(rt) {
    if (rt.stopped) return;
    const c = imap.client(rt.account, secretFor(rt.account.id).password || '');
    rt.watch = c;
    c.on('error', (e) => log(`${rt.account.id} watch: ${e.message}`));
    c.on('close', () => {
        if (rt.watch !== c || rt.stopped) return;
        rt.watch = null;
        setStatus(rt, 'connecting', 'Reconnecting...');
        const t = setTimeout(() => startWatch(rt).catch(() => {}), rt.retryMs = Math.min((rt.retryMs || 2000) * 2, 120000));
        if (t.unref) t.unref();
    });
    try {
        await c.connect();
        await c.mailboxOpen('INBOX');
        rt.retryMs = 2000;
        setStatus(rt, 'connected', '');
        c.on('exists', () => { onNewMail(rt).catch((e) => log(`${rt.account.id} new mail: ${e.message}`)); });
        c.on('flags', (d) => {
            if (!d || !d.uid) return;
            if (store.setFlags(rt.account.id, 'INBOX', d.uid, [...(d.flags || [])])) { store.recount(rt.account.id, 'INBOX'); broadcast({ event: 'flags', accountId: rt.account.id, folder: 'INBOX', uids: [d.uid] }); }
        });
        c.on('expunge', () => { syncSoon(rt, ['INBOX']); });
        // this imapflow does not idle by itself: keep IDLE running (it ends on its own every few
        // minutes and when another command runs on the connection; both just start it again)
        (async () => {
            while (rt.watch === c && !rt.stopped && c.usable) {
                try { await c.idle(); } catch (_) { break; }
            }
        })();
    } catch (error) {
        setStatus(rt, 'error', error.authenticationFailed ? 'The mail server refused the user name or password.' : error.message);
        try { c.close(); } catch (_) { /* gone */ }
    }
}

async function onNewMail(rt) {
    const c = rt.watch;
    if (!c) return;
    const id = rt.account.id;
    const since = store.maxUid(id, 'INBOX');
    const fresh = (await c.search({ uid: `${since + 1}:*` }, { uid: true })).filter((u) => u > since);
    if (!fresh.length) return;
    const rows = await imap.fetchRows(c, fresh);
    store.putMessages(id, 'INBOX', rows);
    store.recount(id, 'INBOX');
    rt.lastPush = Date.now();
    const notifyOn = !(rt.account.settings && rt.account.settings.notify === false);
    for (const r of rows) {
        broadcast({ event: 'new', accountId: id, folder: 'INBOX', uids: [r.uid], message: summaryOf(id, 'INBOX', rowToItem(r)), notify: notifyOn && !(r.flags || []).includes('\\Seen') });
    }
}

let syncTimers = new Map();
function syncSoon(rt, folders) {
    clearTimeout(syncTimers.get(rt.account.id));
    const t = setTimeout(() => runSync(rt, folders), 1500);
    if (t.unref) t.unref();
    syncTimers.set(rt.account.id, t);
}

/** The full (or a few folders') sync in the worker process; announces what changed. */
function runSync(rt, folders) {
    if (rt.syncChild || rt.stopped) return false;
    const child = fork(path.join(__dirname, 'mailAccountsSyncWorker.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    rt.syncChild = child;
    rt.syncing = true;
    child.on('message', (m) => {
        if (!m) return;
        if (m.progress) rt.syncProgress = m.progress;
        if (m.log) log(`${rt.account.id} sync: ${m.log}`);
        if (m.error) { log(`${rt.account.id} sync failed: ${m.error}`); rt.syncError = m.error; }
        if (m.done) {
            rt.syncError = '';
            for (const ch of m.changes || []) broadcast({ event: 'folders', accountId: rt.account.id, folder: ch.folder, fetched: ch.fetched, removed: ch.removed, flagsChanged: ch.flagsChanged });
        }
    });
    child.on('exit', () => {
        rt.syncChild = null;
        rt.syncing = false;
        rt.syncProgress = null;
        broadcast({ event: 'sync', accountId: rt.account.id });
    });
    child.send({ cmd: 'sync', account: rt.account, password: secretFor(rt.account.id).password || '', cacheDir: cacheDir(), folders: folders || null });
    return true;
}

function startAccount(account) {
    stopAccount(account.id);
    if (account.enabled === false) return;
    const rt = { account, status: 'connecting', error: '', watch: null, ops: null, stopped: false };
    runtimes.set(account.id, rt);
    startWatch(rt).catch(() => {});
    runSync(rt);
    rt.timer = setInterval(() => runSync(rt), SYNC_EVERY_MS);
    if (rt.timer.unref) rt.timer.unref();
}

function stopAccount(id) {
    const rt = runtimes.get(id);
    if (!rt) return;
    rt.stopped = true;
    clearInterval(rt.timer);
    clearTimeout(rt.opsTimer);
    for (const c of [rt.watch, rt.ops]) if (c) c.logout().catch(() => {});
    if (rt.syncChild) { try { rt.syncChild.kill(); } catch (_) { /* gone */ } }
    runtimes.delete(id);
}

function init(globalResources) {
    if (globalResources) gr = globalResources;
    if (started) return;
    started = true;
    try { store.open(cacheDir()); } catch (error) { log(`store unavailable: ${error.message}`); return; }
    for (const a of readConfig().accounts) startAccount(a);
    const t = setInterval(() => { const now = Date.now(); for (const [k, u] of uploads) if (now - u.at > 3600000) { fs.promises.unlink(u.file).catch(() => {}); uploads.delete(k); } }, 600000);
    if (t.unref) t.unref();
}

function rt(id) {
    const r = runtimes.get(String(id || ''));
    if (!r) throw fail('NO_ACCOUNT', 'That e-mail account is not running.');
    return r;
}

// ---- shapes ----

function rowToItem(r) {
    const flags = Array.isArray(r.flags) ? r.flags : (() => { try { return JSON.parse(r.flags || '[]'); } catch (_) { return []; } })();
    const env = typeof r.env === 'string' ? (() => { try { return JSON.parse(r.env); } catch (_) { return {}; } })() : (r.env || {});
    return {
        uid: r.uid, msgid: r.msgid || null, date: r.date, subject: r.subject || '', sender: r.sender || '', recipients: r.recipients || '',
        from: env.from || [], to: env.to || [], cc: env.cc || [], flags, seen: flags.includes('\\Seen'), flagged: flags.includes('\\Flagged'),
        answered: flags.includes('\\Answered'), size: r.size || 0, snippet: r.snippet || '', hasAttachments: !!(r.has_att || (r.att && r.att.some && r.att.some((a) => !a.inline)))
    };
}

function summaryOf(accountId, folder, item) { return Object.assign({ accountId, folder }, item); }

function accountOut(a) {
    const r = runtimes.get(a.id);
    let st = null;
    try { st = store.stats(a.id); } catch (_) { st = null; }
    const inbox = (() => { try { return store.getFolder(a.id, 'INBOX'); } catch (_) { return null; } })();
    return {
        id: a.id, email: a.email, displayName: a.displayName || '', name: a.displayName || a.email, kind: 'imap',
        imap: Object.assign({}, a.imap), smtp: Object.assign({}, a.smtp), enabled: a.enabled !== false, settings: Object.assign({ notify: true, saveSent: 'auto' }, a.settings || {}),
        hasPassword: !!secretFor(a.id).password, status: r ? r.status : (a.enabled === false ? 'disabled' : 'error'), error: r ? (r.error || r.syncError || '') : '',
        unread: inbox ? inbox.unseen : null,
        sync: st ? Object.assign(st, { running: !!(r && r.syncing), progress: r ? r.syncProgress || null : null, lastSync: Number(store.getState(a.id, 'lastSync')) || null, complete: store.getState(a.id, 'complete') === '1' }) : null,
        push: !!(r && r.watch && r.watch.usable), lastPush: r ? r.lastPush || null : null
    };
}

// ---- public API ----

function listAccounts() { return { accounts: readConfig().accounts.map(accountOut), presets: PRESETS.map(({ domains, ...p }) => Object.assign({ domains }, p)) }; }

function normalizeAccount(body, prev) {
    const email = String(body.email || (prev && prev.email) || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('BAD_EMAIL', 'Type the e-mail address.');
    const preset = presetFor(email);
    const side = (key) => {
        const src = Object.assign({}, preset ? preset[key] : {}, prev ? prev[key] : {}, body[key] || {});
        if (!src.host) throw fail('NO_HOST', `Type the ${key.toUpperCase()} server.`);
        return { host: String(src.host).trim(), port: Number(src.port) || (key === 'imap' ? 993 : 465), security: ['tls', 'starttls', 'none'].includes(src.security) ? src.security : 'tls', user: String(src.user || email).trim(), allowSelfSigned: !!src.allowSelfSigned };
    };
    return { email, displayName: String(body.displayName != null ? body.displayName : (prev && prev.displayName) || '').trim(), imap: side('imap'), smtp: side('smtp') };
}

async function testAccount(body) {
    const prev = body.id ? readConfig().accounts.find((a) => a.id === body.id) : null;
    const a = Object.assign({ id: 'test' }, normalizeAccount(body, prev));
    const password = body.password || (prev ? secretFor(prev.id).password : '');
    if (!password) throw fail('NO_PASSWORD', 'Type the password (or app password).');
    const c = imap.client(a, password);
    c.on('error', () => {});
    let folders = [];
    try {
        await c.connect();
        folders = await imap.listFolders(c);
    } catch (error) {
        throw fail('IMAP_FAILED', error.authenticationFailed ? 'The mail server refused the user name or password.' : `IMAP: ${error.message}`);
    } finally { c.logout().catch(() => {}); }
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport(smtpOptions(a, body.smtpPassword || password));
    try { await t.verify(); } catch (error) { throw fail('SMTP_FAILED', `SMTP: ${error.message}`); } finally { t.close(); }
    return { folders: folders.length, inbox: (folders.find((f) => f.special === '\\Inbox') || {}).total || 0 };
}

function saveAccount(body) {
    const cfg = readConfig();
    let id = String(body.id || '').trim().toLowerCase();
    const prev = id ? cfg.accounts.find((a) => a.id === id) : null;
    const a = normalizeAccount(body, prev);
    if (!id) {
        const base = a.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'mail';
        id = base;
        for (let n = 2; cfg.accounts.some((x) => x.id === id); n += 1) id = `${base}${n}`;
    }
    const settings = Object.assign({ notify: true, saveSent: 'auto' }, prev ? prev.settings : {});
    if (body.settings && typeof body.settings === 'object') {
        if (typeof body.settings.notify === 'boolean') settings.notify = body.settings.notify;
        if (['auto', 'always', 'never'].includes(body.settings.saveSent)) settings.saveSent = body.settings.saveSent;
    }
    const row = Object.assign({ id }, a, { enabled: body.enabled !== false, settings });
    const at = cfg.accounts.findIndex((x) => x.id === id);
    if (at >= 0) cfg.accounts[at] = row; else cfg.accounts.push(row);
    writeConfig(cfg);
    if (body.password) writeSecret(id, { password: String(body.password) });
    if (body.smtpPassword) writeSecret(id, { smtpPassword: String(body.smtpPassword) });
    if (!secretFor(id).password) throw fail('NO_PASSWORD', 'Type the password (or app password).');
    startAccount(row);
    broadcast({ event: 'account', accountId: id });
    return accountOut(row);
}

function deleteAccount(id) {
    const cfg = readConfig();
    cfg.accounts = cfg.accounts.filter((a) => a.id !== id);
    writeConfig(cfg);
    writeSecret(id, null);
    stopAccount(id);
    try { store.forgetAccount(id); } catch (_) { /* store closed */ }
    broadcast({ event: 'account', accountId: id, removed: true });
    return { ok: true };
}

function listFolders(accountId) {
    rt(accountId);
    const order = (f) => (f.special === '\\Inbox' ? 0 : f.special === '\\Drafts' ? 1 : f.special === '\\Sent' ? 2 : f.special === '\\Archive' ? 3 : f.special === '\\Junk' ? 8 : f.special === '\\Trash' ? 9 : 5);
    return { folders: store.listFolders(accountId).sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path)) };
}

function listMessages(accountId, folder, { limit = 50, before = null, unseenOnly = false } = {}) {
    rt(accountId);
    const n = Math.min(Number(limit) || 50, 500);
    const rows = store.listMessages(accountId, folder, { limit: n + 1, before, unseenOnly });
    const items = rows.slice(0, n).map((r) => summaryOf(accountId, folder, rowToItem(r)));
    return { messages: items, more: rows.length > n, cursor: items.length ? String(items[items.length - 1].date) : null };
}

/** One message with its body (HTML sanitized, cid: pictures pointed at the attachment URL). */
async function getMessage(accountId, folder, uid, { markSeen = true } = {}) {
    const r0 = rt(accountId);
    let row = store.getMessage(accountId, folder, Number(uid));
    if (!row) throw fail('NOT_FOUND', 'That message is not in this folder any more.');
    if (!row.body) {
        // a body the sync could not read yet: from the mail server now
        try {
            const c = await opsClient(r0);
            const lock = await c.getMailboxLock(folder);
            try { store.putMessages(accountId, folder, await imap.fetchRows(c, [Number(uid)])); } finally { lock.release(); }
            row = store.getMessage(accountId, folder, Number(uid)) || row;
        } catch (error) { log(`${accountId} body: ${error.message}`); }
    }
    const item = summaryOf(accountId, folder, rowToItem(row));
    const att = (() => { try { return JSON.parse(row.att || '[]'); } catch (_) { return []; } })();
    const env = (() => { try { return JSON.parse(row.env || '{}'); } catch (_) { return {}; } })();
    const base = `/api/mailaccounts/${encodeURIComponent(accountId)}/attachment?folder=${encodeURIComponent(folder)}&uid=${row.uid}&part=`;
    item.attachments = att.map((a) => Object.assign({}, a, { url: base + encodeURIComponent(a.part) }));
    item.text = row.text || '';
    item.replyTo = env.replyTo || [];
    item.bcc = env.bcc || [];
    item.inReplyTo = env.inReplyTo || null;
    item.references = env.references || null;
    item.listUnsubscribe = env.listUnsubscribe || null;
    let html = row.html || '';
    if (html) {
        for (const a of att) if (a.cid) html = html.split(`cid:${a.cid}`).join(base + encodeURIComponent(a.part));
        try {
            const s = require('./dovecoteSanitize').sanitizeHtml(html, { allowRemoteImages: false });
            item.html = s.html;
            item.remoteImages = s.remoteImages || [];
        } catch (_) { item.html = ''; }
    } else item.html = '';
    if (markSeen && !item.seen) {
        setFlags(accountId, folder, [row.uid], { add: ['\\Seen'] }).catch((e) => log(`${accountId} seen: ${e.message}`));
        item.seen = true;
    }
    return { message: item };
}

/** Flags at the mail server first, then the copy. */
async function setFlags(accountId, folder, uidList, { add = [], remove = [] } = {}) {
    const r0 = rt(accountId);
    const list = (uidList || []).map(Number).filter((u) => u > 0);
    if (!list.length) return { ok: true };
    const c = await opsClient(r0);
    const lock = await c.getMailboxLock(folder);
    try {
        if (add.length) await c.messageFlagsAdd(list.join(','), add, { uid: true });
        if (remove.length) await c.messageFlagsRemove(list.join(','), remove, { uid: true });
        for await (const m of c.fetch(list.join(','), { uid: true, flags: true }, { uid: true })) store.setFlags(accountId, folder, m.uid, [...(m.flags || [])]);
    } finally { lock.release(); }
    store.recount(accountId, folder);
    broadcast({ event: 'flags', accountId, folder, uids: list });
    return { ok: true };
}

async function move(accountId, folder, uidList, to) {
    const r0 = rt(accountId);
    const list = (uidList || []).map(Number).filter((u) => u > 0);
    if (!list.length || !to || to === folder) return { ok: true };
    const c = await opsClient(r0);
    const lock = await c.getMailboxLock(folder);
    try { await c.messageMove(list.join(','), to, { uid: true }); } finally { lock.release(); }
    store.deleteMessages(accountId, folder, list);
    store.recount(accountId, folder);
    broadcast({ event: 'removed', accountId, folder, uids: list });
    syncSoon(r0, [to]);
    return { ok: true };
}

/** Delete: into Trash, or for good when already in Trash (or the server has none). */
async function remove(accountId, folder, uidList) {
    const r0 = rt(accountId);
    const trash = store.listFolders(accountId).find((f) => f.special === '\\Trash');
    if (trash && trash.path !== folder) return move(accountId, folder, uidList, trash.path);
    const list = (uidList || []).map(Number).filter((u) => u > 0);
    const c = await opsClient(r0);
    const lock = await c.getMailboxLock(folder);
    try { await c.messageDelete(list.join(','), { uid: true }); } finally { lock.release(); }
    store.deleteMessages(accountId, folder, list);
    store.recount(accountId, folder);
    broadcast({ event: 'removed', accountId, folder, uids: list });
    return { ok: true };
}

function smtpOptions(a, password) {
    return {
        host: a.smtp.host, port: a.smtp.port, secure: a.smtp.security === 'tls', requireTLS: a.smtp.security === 'starttls',
        auth: { user: a.smtp.user || a.email, pass: password }, connectionTimeout: 30000, greetingTimeout: 20000, socketTimeout: 120000,
        tls: { rejectUnauthorized: !a.smtp.allowSelfSigned }
    };
}

/**
 * Send: { to, cc, bcc, subject, text, html, attachments: [uploadId], reply: { folder, uid, kind: 'reply'|'forward' } }.
 * Saved to Sent by APPEND unless the provider keeps sent mail itself (Gmail, Outlook.com).
 */
async function send(accountId, body) {
    const r0 = rt(accountId);
    const a = r0.account;
    const sec = secretFor(accountId);
    const nodemailer = require('nodemailer');
    const MailComposer = require('nodemailer/lib/mail-composer');
    const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[;,]/)).map((s) => String(s).trim()).filter(Boolean);
    const to = list(body.to);
    const cc = list(body.cc);
    const bcc = list(body.bcc);
    if (!to.length && !cc.length && !bcc.length) throw fail('NO_RECIPIENT', 'Who is the message for?');
    const msg = { from: a.displayName ? { name: a.displayName, address: a.email } : a.email, to, cc, bcc, subject: String(body.subject || ''), text: body.text != null ? String(body.text) : undefined, html: body.html ? String(body.html) : undefined, attachments: [] };
    for (const idAtt of body.attachments || []) {
        const u = uploads.get(idAtt);
        if (!u) throw fail('NO_UPLOAD', 'An attachment expired. Attach it again.');
        msg.attachments.push({ filename: u.name, path: u.file, contentType: u.type });
    }
    if (body.reply && body.reply.uid) {
        const orig = store.getMessage(accountId, body.reply.folder, Number(body.reply.uid));
        if (orig && orig.msgid) {
            msg.inReplyTo = orig.msgid;
            let refs = '';
            try { const env = JSON.parse(orig.env || '{}'); refs = Array.isArray(env.references) ? env.references.join(' ') : (env.references || ''); } catch (_) { refs = ''; }
            msg.references = `${refs} ${orig.msgid}`.trim();
        }
    }
    const transport = nodemailer.createTransport(smtpOptions(a, sec.smtpPassword || sec.password || ''));
    let info;
    try { info = await transport.sendMail(msg); } catch (error) { throw fail('SMTP_FAILED', `The message could not be sent: ${error.message}`); } finally { transport.close(); }
    // Sent folder
    const preset = presetFor(a.email);
    const save = (a.settings && a.settings.saveSent) || 'auto';
    const sent = store.listFolders(accountId).find((f) => f.special === '\\Sent');
    if (sent && (save === 'always' || (save === 'auto' && !(preset && preset.autoSent)))) {
        try {
            const raw = await new MailComposer(Object.assign({}, msg, { bcc: undefined, messageId: info.messageId })).compile().build();
            const c = await opsClient(r0);
            await c.append(sent.path, raw, ['\\Seen']);
        } catch (error) { log(`${accountId} sent copy: ${error.message}`); }
    }
    if (body.reply && body.reply.uid && body.reply.kind !== 'forward') setFlags(accountId, body.reply.folder, [body.reply.uid], { add: ['\\Answered'] }).catch(() => {});
    for (const idAtt of body.attachments || []) { const u = uploads.get(idAtt); if (u) { fs.promises.unlink(u.file).catch(() => {}); uploads.delete(idAtt); } }
    if (sent) syncSoon(r0, [sent.path]);
    return { ok: true, messageId: info.messageId };
}

/** An attachment's body from the mail server (the copy keeps only its listing), cached on disk. */
async function attachment(accountId, folder, uid, part) {
    const r0 = rt(accountId);
    const row = store.getMessage(accountId, folder, Number(uid));
    if (!row) throw fail('NOT_FOUND', 'That message is not in this folder any more.');
    const att = (() => { try { return JSON.parse(row.att || '[]'); } catch (_) { return []; } })().find((x) => x.part === String(part));
    if (!att) throw fail('NOT_FOUND', 'No such attachment.');
    const dir = path.join(cacheDir(), 'mailaccounts-attachments');
    const key = require('crypto').createHash('sha1').update(`${accountId}|${folder}|${row.uid}|${part}|${store.getFolder(accountId, folder) ? store.getFolder(accountId, folder).uidvalidity : ''}`).digest('hex');
    const file = path.join(dir, key);
    if (!fs.existsSync(file)) {
        const c = await opsClient(r0);
        const lock = await c.getMailboxLock(folder);
        try {
            const dl = await c.download(String(row.uid), String(part), { uid: true });
            await fs.promises.mkdir(dir, { recursive: true });
            const tmp = `${file}.part`;
            await new Promise((resolve, reject) => { const w = fs.createWriteStream(tmp); dl.content.pipe(w); w.on('finish', resolve); w.on('error', reject); dl.content.on('error', reject); });
            await fs.promises.rename(tmp, file);
        } finally { lock.release(); }
    }
    return { file, name: att.filename, type: att.type || 'application/octet-stream' };
}

function addUpload(buffer, name, type) {
    const dir = path.join(cacheDir(), 'mailaccounts-uploads');
    fs.mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    const file = path.join(dir, id);
    fs.writeFileSync(file, buffer);
    uploads.set(id, { file, name: String(name || 'attachment').slice(0, 200), type: type || 'application/octet-stream', size: buffer.length, at: Date.now() });
    return { uploadId: id, size: buffer.length };
}

function search(q, { accountId = null, limit = 40 } = {}) {
    const rows = store.search(q, { account: accountId, limit: Math.min(Number(limit) || 40, 200) });
    return { results: rows.map((r) => summaryOf(r.account, r.folder, rowToItem(r))) };
}

function syncStatus() {
    const accounts = readConfig().accounts.map(accountOut);
    let att = 0;
    try { const dir = path.join(cacheDir(), 'mailaccounts-attachments'); for (const f of fs.readdirSync(dir)) { try { att += fs.statSync(path.join(dir, f)).size; } catch (_) { /* gone */ } } } catch (_) { /* none */ }
    return { accounts, storage: { database: store.sizeOnDisk(), attachments: att } };
}

function resync(accountId, { rebuild = false } = {}) {
    const r0 = rt(accountId);
    if (rebuild) store.forgetAccount(accountId);
    if (!runSync(r0)) throw fail('BUSY', 'A sync is already running.');
    return { ok: true };
}

function unreadSummary() {
    return readConfig().accounts.map((a) => { const f = (() => { try { return store.getFolder(a.id, 'INBOX'); } catch (_) { return null; } })(); return { id: a.id, unread: f ? f.unseen : 0 }; });
}

module.exports = {
    init, listAccounts, testAccount, saveAccount, deleteAccount, listFolders, listMessages, getMessage, setFlags, move, remove, send,
    attachment, addUpload, search, syncStatus, resync, unreadSummary, presetFor, PRESETS
};
