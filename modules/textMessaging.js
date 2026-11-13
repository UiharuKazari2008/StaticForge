/**
 * Text Messaging accounts (Yozora #779): iMessage through BlueBubbles, later RCS through the
 * Google Messages pairing, behind one provider-neutral interface for Messaging on the phone,
 * Melaton Messenger on the desktop and the Android app's notifications.
 *
 * Config (config.json textMessaging):  { accounts: [{ id, kind, url, enabled }], notifyUnknown }
 * Secrets (secure.config.json textMessaging.keys[]): { name: <account id>, password }
 *
 * Chat (provider-neutral):
 *   { guid, identifier, title, named, isGroup, participants:[{address,name,service}], service,
 *     archived, last: Message|null, unread, known }
 * Message:
 *   { guid, chatGuid, text, subject, fromMe, sender:{address,name,me}, date, dateDelivered,
 *     dateRead, dateEdited, retracted, error, service, replyTo, effect, groupEvent,
 *     attachments:[{guid,name,mime,size,width,height,sticker,url,thumbUrl}],
 *     reactions:[{type,fromMe,sender,guid,date}] }
 *
 * A chat is "known" when a participant is in the provider's contacts (the iPhone's, through
 * BlueBubbles) or in a Dreamscape Contacts card (phone or e-mail), or when you have written in it.
 * Unknown chats are the Unknown Senders folder; their messages notify only when notifyUnknown is on.
 *
 * Events (ws `tm_event`, admins only; also onEvent() listeners in the server):
 *   { event: 'message'|'updated'|'reaction'|'typing'|'read'|'chat'|'account'|'resync',
 *     accountId, chatGuid, message?, reaction?, targetGuid?, typing?, read?, known?, notify? }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { BlueBubblesProvider, handleKey, normalizeUrl, DEFAULT_SETTINGS: BB_DEFAULTS } = require('./textMessagingBlueBubbles');
const { RcsProvider } = require('./textMessagingRcs');
const store = require('./textMessagingStore');

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const KINDS = ['bluebubbles', 'rcs'];
const CONTACT_SCAN_MS = 5 * 60 * 1000;
const SUMMARY_TTL_MS = 30 * 1000;

let gr = null;
const providers = new Map(); // id -> provider
const listeners = new Set();
const summaries = new Map(); // id -> { at, value }
let knownChats = null;       // Set of "<accountId>|<chatGuid>" you have written in
let dsContacts = { at: 0, keys: new Map(), promise: null };
let started = false;

function resources() {
    if (!gr) gr = require('./globalResources');
    return gr;
}

function log(msg) { console.log(`[textMessaging] ${msg}`); }

// ---- config ----

function readConfig() {
    let block = null;
    try { block = resources().getConfig({ path: 'textMessaging' }); } catch (_) { block = null; }
    const b = block && typeof block === 'object' ? block : {};
    return {
        accounts: Array.isArray(b.accounts) ? b.accounts.filter((a) => a && ID_RE.test(String(a.id || ''))) : [],
        notifyUnknown: b.notifyUnknown === true
    };
}

function writeConfig(next) {
    resources().updateConfigValue('config', ['textMessaging'], { accounts: next.accounts, notifyUnknown: next.notifyUnknown === true });
}

function readSecrets() {
    let block = null;
    try { block = resources().getSecureConfig({ path: 'textMessaging' }); } catch (_) { block = null; }
    return block && Array.isArray(block.keys) ? block.keys : [];
}

function passwordFor(id) {
    const row = readSecrets().find((k) => k && k.name === id);
    return row ? String(row.password || '') : '';
}

function writePassword(id, password) {
    const keys = readSecrets().filter((k) => k && k.name !== id).map((k) => Object.assign({}, k));
    if (password) keys.push({ name: id, password });
    resources().updateConfigValue('secureConfig', ['textMessaging'], { keys });
}

// ---- known chats (you wrote in them) ----

function knownFile() {
    let dir;
    try { dir = resources().getPath('cache'); } catch (_) { dir = null; }
    return path.join(dir || path.join(__dirname, '..', '.cache'), 'textmessaging-known.json');
}

function loadKnown() {
    if (knownChats) return knownChats;
    knownChats = new Set();
    try {
        const arr = JSON.parse(fs.readFileSync(knownFile(), 'utf8'));
        if (Array.isArray(arr)) arr.forEach((k) => knownChats.add(String(k)));
    } catch (_) { /* first run */ }
    return knownChats;
}

let knownSaveTimer = null;
function markWritten(accountId, chatGuid) {
    if (!chatGuid) return;
    const set = loadKnown();
    const key = `${accountId}|${chatGuid}`;
    if (set.has(key)) return;
    set.add(key);
    clearTimeout(knownSaveTimer);
    knownSaveTimer = setTimeout(() => {
        try { fs.writeFileSync(knownFile(), JSON.stringify([...set])); } catch (error) { log(`known save failed: ${error.message}`); }
    }, 2000);
    if (knownSaveTimer.unref) knownSaveTimer.unref();
}

// ---- read marks (BlueBubbles) ----
// BlueBubbles reports no read flag, and many old SMS carry no read date, so their chats would read as
// unread forever. Like BlueBubbles' own clients, Dreamscape keeps its own: everything before the first
// start with this file is read; a chat is unread when an incoming message is newer than the last time
// it was read here, on the iPhone / Mac (a read date or a read event) or answered.

let readMarks = null; // { baseline, chats: { "<account>|<chat>": ms } }
let readSaveTimer = null;

function readFile() {
    let dir;
    try { dir = resources().getPath('cache'); } catch (_) { dir = null; }
    return path.join(dir || path.join(__dirname, '..', '.cache'), 'textmessaging-read.json');
}

function loadReadMarks() {
    if (readMarks) return readMarks;
    try {
        const d = JSON.parse(fs.readFileSync(readFile(), 'utf8'));
        readMarks = { baseline: Number(d.baseline) || Date.now(), chats: d.chats && typeof d.chats === 'object' ? d.chats : {} };
    } catch (_) {
        readMarks = { baseline: Date.now(), chats: {} };
        saveReadMarks();
    }
    return readMarks;
}

function saveReadMarks() {
    clearTimeout(readSaveTimer);
    readSaveTimer = setTimeout(() => {
        try { fs.writeFileSync(readFile(), JSON.stringify(readMarks)); } catch (error) { log(`read marks save failed: ${error.message}`); }
    }, 1500);
    if (readSaveTimer.unref) readSaveTimer.unref();
}

function markChatRead(accountId, chatGuid, at) {
    if (!chatGuid) return;
    const r = loadReadMarks();
    const key = `${accountId}|${chatGuid}`;
    if (r.unread && r.unread[key]) { delete r.unread[key]; saveReadMarks(); }
    const t = at || Date.now();
    if ((r.chats[key] || 0) >= t) return;
    r.chats[key] = t;
    saveReadMarks();
}

/** Mark as Unread (a held conversation): it stays unread until it is read again. */
function markChatUnread(accountId, chatGuid) {
    if (!chatGuid) return;
    const r = loadReadMarks();
    if (!r.unread) r.unread = {};
    r.unread[`${accountId}|${chatGuid}`] = Date.now();
    saveReadMarks();
}

/** A chat's unread state: Mark as Unread first, then (BlueBubbles) the read marks. */
function applyReadMark(accountId, chat) {
    const p = providers.get(accountId);
    if (!chat) return;
    const r0 = loadReadMarks();
    if (r0.unread && r0.unread[`${accountId}|${chat.guid}`]) { chat.unread = true; chat.markedUnread = true; return; }
    if (!p || p.kind !== 'bluebubbles') return;
    const last = chat.last;
    if (!last || last.fromMe || last.dateRead) { chat.unread = false; return; }
    const r = loadReadMarks();
    const mark = r.chats[`${accountId}|${chat.guid}`] || 0;
    // iMessage writes a read date when the message is read on the iPhone or the Mac, so a recent one
    // without it is unread; forwarded SMS never get one: those count only after the last read here
    const imessage = String(chat.guid || '').startsWith('iMessage');
    const floor = imessage ? Date.now() - IMESSAGE_UNREAD_DAYS * 86400000 : r.baseline;
    chat.readSince = Math.max(floor, mark);
    chat.unread = (Number(last.date) || 0) > chat.readSince;
    // each chat of a merged conversation by its own kind: iMessage by its read dates, SMS from the marks
    chat.readSinceFor = (g) => Math.max(String(g).startsWith('iMessage') ? Date.now() - IMESSAGE_UNREAD_DAYS * 86400000 : r.baseline, mark);
}
const IMESSAGE_UNREAD_DAYS = 14;

/** How many unread messages each unread conversation holds (unreadCount; 1 when it cannot be counted). */
async function countUnread(accountId, chats) {
    const p = providers.get(accountId);
    const todo = chats.filter((c) => c.unread && !c.markedUnread).slice(0, 40);
    for (const c of chats) if (c.markedUnread) c.unreadCount = 1;
    await Promise.all(todo.map(async (c) => {
        if (p && typeof p.countIncoming === 'function' && c.readSince != null) {
            try { c.unreadCount = Math.max(1, await p.countIncoming(c.guid, c.readSinceFor || c.readSince)); } catch (_) { c.unreadCount = 1; }
        } else {
            c.unreadCount = 1;
        }
    }));
    for (const c of chats) { if (!c.unread) c.unreadCount = 0; delete c.readSince; delete c.readSinceFor; delete c.markedUnread; }
}

// ---- Dreamscape Contacts (every workspace's Contacts folder) ----

async function scanDreamscapeContacts() {
    const keys = new Map();
    try {
        const VC = require('../public/scripts/comp/vcard.js');
        const vfsDatabase = require('./vfsDatabase');
        const vfs = resources().getVfsManager();
        const all = resources().getWorkspaceManager().getWorkspaces() || {};
        for (const workspaceId of Object.keys(all)) {
            let folder = null;
            try { folder = await vfs._findWorkspaceFolderByName(workspaceId, null, 'Contacts', { excludeDesktop: true }); } catch (_) { folder = null; }
            if (!folder) continue;
            const files = (await vfsDatabase.getUserFilesByLocation('workspace', workspaceId, folder.id)) || [];
            for (const f of files) {
                if (!/\.vcf$/i.test(f.original_name || '')) continue;
                let cards = [];
                try { cards = VC.parseVcf(await fs.promises.readFile(vfs.getFileBlobPath(f.content_hash), 'utf8')); } catch (_) { continue; }
                for (const c of cards) {
                    const name = VC.displayName ? VC.displayName(c) : (c.fn || '');
                    const addrs = [...(c.emails || []), c.home && c.home.mobile, c.home && c.home.phone, c.work && c.work.phone];
                    for (const a of addrs) { const k = handleKey(a); if (k && k.length >= 7 && !keys.has(k)) keys.set(k, name || ''); }
                }
            }
        }
    } catch (error) {
        log(`contacts scan failed: ${error.message}`);
    }
    return keys;
}

async function dreamscapeContacts() {
    if (Date.now() - dsContacts.at < CONTACT_SCAN_MS) return dsContacts.keys;
    if (!dsContacts.promise) {
        dsContacts.promise = scanDreamscapeContacts().then((keys) => {
            dsContacts = { at: Date.now(), keys, promise: null };
            return keys;
        }, () => { dsContacts.promise = null; return dsContacts.keys; });
    }
    // a stale list answers now; the first scan is waited for
    return dsContacts.at ? dsContacts.keys : dsContacts.promise;
}

function decorateParticipants(chat, ds) {
    for (const p of chat.participants || []) {
        if (!p.name) { const n = ds.get(handleKey(p.address)); if (n) p.name = n; }
    }
    if (!chat.named) chat.title = (chat.participants || []).map((p) => p.name || p.display || p.address).join(', ') || chat.title;
}

function isKnownChat(accountId, chat, ds) {
    const known = loadKnown();
    if ((chat.guids || [chat.guid]).some((g) => known.has(`${accountId}|${g}`))) return true;
    if (chat.spam) return false;
    if (chat.last && chat.last.fromMe) { markWritten(accountId, chat.guid); return true; }
    // a business's own name is not a contact: it stays in Unknown Senders unless you saved it
    return (chat.participants || []).some((p) => (p.name && !p.business) || ds.has(handleKey(p.address)));
}

// ---- providers ----

function makeProvider(account) {
    const hooks = { emit: (event, payload) => onProviderEvent(account.id, event, payload), log: (m) => log(`${account.id}: ${m}`) };
    if (account.kind === 'bluebubbles') return new BlueBubblesProvider({ id: account.id, url: account.url, password: passwordFor(account.id), settings: account.settings }, hooks);
    if (account.kind === 'rcs') {
        let cacheDir = null;
        try { cacheDir = resources().getPath('cache'); } catch (_) { cacheDir = null; }
        return new RcsProvider({ id: account.id }, hooks, { cacheDir: cacheDir || undefined });
    }
    return null;
}

function storeOpen() {
    try {
        let dir = null;
        try { dir = resources().getPath('cache'); } catch (_) { dir = null; }
        store.open(dir || undefined);
        return store;
    } catch (error) {
        log(`store unavailable: ${error.message}`);
        return null;
    }
}

function startAccount(account) {
    stopAccount(account.id);
    if (account.enabled === false) return;
    const p = makeProvider(account);
    if (!p) return;
    // the server's own copy of every conversation (textMessagingStore.js): the providers sync into it
    p.store = storeOpen();
    try { p.storeDir = resources().getPath('cache'); } catch (_) { p.storeDir = null; }
    providers.set(account.id, p);
    p.start().catch((error) => log(`${account.id} start failed: ${error.message}`));
}

function stopAccount(id) {
    const p = providers.get(id);
    if (p) { try { p.stop(); } catch (_) { /* gone */ } providers.delete(id); }
    summaries.delete(id);
}

function init(globalResources) {
    if (globalResources) gr = globalResources;
    if (started) return;
    started = true;
    for (const a of readConfig().accounts) startAccount(a);
    dreamscapeContacts().catch(() => {});
    scheduleReconcile();
}

function provider(accountId) {
    const p = providers.get(String(accountId || ''));
    if (!p) throw Object.assign(new Error('That Text Messaging account is not connected.'), { code: 'NO_ACCOUNT' });
    return p;
}

// ---- events ----

function broadcast(payload) {
    let server = null;
    try { server = resources().getWebSocketServer && resources().getWebSocketServer(); } catch (_) { server = null; }
    if (server && typeof server.broadcast === 'function') {
        server.broadcast({ type: 'tm_event', data: payload, timestamp: new Date().toISOString() },
            (info) => !!(info && info.authenticated && info.userType === 'admin'));
    }
    for (const fn of listeners) { try { fn(payload); } catch (error) { log(`listener failed: ${error.message}`); } }
}

const lastPush = new Map(); // accountId -> ms of the last message the source pushed

async function onProviderEvent(accountId, event, payload) {
    const out = Object.assign({ event }, payload);
    if (event === 'message' || event === 'updated' || event === 'reaction') lastPush.set(accountId, Date.now());
    try {
        if (event === 'message' || event === 'updated') {
            summaries.delete(accountId);
            const m = payload.message;
            if (m && m.fromMe) { markWritten(accountId, payload.chatGuid); markChatRead(accountId, payload.chatGuid); }
            const ds = await dreamscapeContacts();
            if (m && !m.fromMe && m.sender && !m.sender.name) { const n = ds.get(handleKey(m.sender.address)); if (n) m.sender.name = n; }
            let known = m && m.fromMe ? true : null;
            if (known == null) {
                const p = providers.get(accountId);
                let chat = null;
                if (payload.chat && p && typeof p.normalizeChat === 'function') chat = p.normalizeChat(payload.chat);
                if (!chat && p) { try { chat = await p.getChat(payload.chatGuid); } catch (_) { chat = null; } }
                if (chat) { decorateParticipants(chat, ds); out.chatTitle = chat.title; out.isGroup = chat.isGroup; }
                known = chat ? isKnownChat(accountId, chat, ds) : !!(m && m.sender && (m.sender.name));
                if (!known && chat && p) {
                    // a reply of yours further back makes it known too
                    try {
                        const page = await p.listMessages(payload.chatGuid, { limit: 25 });
                        if (page.messages.some((x) => x.fromMe)) { markWritten(accountId, payload.chatGuid); known = true; }
                    } catch (_) { /* leave it unknown */ }
                }
            }
            delete out.chat;
            out.known = known;
            out.folder = known ? 'inbox' : 'unknown';
            const acctRow = readConfig().accounts.find((x) => x.id === accountId);
            const acctNotify = !(acctRow && acctRow.settings && acctRow.settings.notify === false);
            out.notify = event === 'message' && m && !m.fromMe && !m.groupEvent && acctNotify && (known || readConfig().notifyUnknown);
        } else if (event === 'reaction' || event === 'read') {
            summaries.delete(accountId);
            if (event === 'read' && payload.read !== false) markChatRead(accountId, payload.chatGuid);
        }
    } catch (error) {
        log(`event ${event} failed: ${error.message}`);
    }
    broadcast(out);
}

function onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---- public API ----

function accountOut(a) {
    const p = providers.get(a.id);
    const s = summaries.get(a.id);
    return {
        id: a.id,
        kind: a.kind,
        // BlueBubbles accounts read as Apple iMessage (Yukimi, Nov 13); RCS keeps Text Messaging
        name: a.kind === 'bluebubbles' ? 'Apple iMessage' : 'Text Messaging',
        service: a.kind === 'bluebubbles' ? 'iMessage' : 'RCS',
        url: a.url || '',
        enabled: a.enabled !== false,
        hasPassword: a.kind === 'rcs' ? true : !!passwordFor(a.id),
        status: p ? p.status : (a.enabled === false ? 'disabled' : 'error'),
        error: p ? p.error : '',
        identity: p ? p.identity() : '',
        features: p ? p.features() : {},
        unread: s ? s.value.unread : null,
        unknownUnread: s ? s.value.unknownUnread : null,
        settings: a.kind === 'bluebubbles' ? Object.assign({}, BB_DEFAULTS, a.settings || {}) : Object.assign({ notify: true }, a.settings || {}),
        sync: syncInfo(a.id, p),
        server: p && p.info ? { version: p.info.server_version || '', macOs: p.info.os_version || '', privateApi: !!p.info.private_api, helper: !!p.info.helper_connected, computer: p.info.computer_id || '' } : null
    };
}

/** How far the server's copy of the account is: { chats, messages, complete, running, done, total }. */
function syncInfo(id, p) {
    try {
        if (!storeOpen()) return null;
        const st = store.stats(id);
        const complete = p && p.kind === 'rcs' ? store.getState(id, 'chats') === '1' && st.syncedChats >= st.chats : store.getState(id, 'complete') === '1';
        const prog = p && p.syncProgress;
        return { chats: st.chats, messages: st.messages, complete, running: !!(p && p.syncing), done: prog ? prog.done : null, total: prog && prog.total != null ? prog.total : null };
    } catch (_) { return null; }
}

function listAccounts() {
    const cfg = readConfig();
    return { accounts: cfg.accounts.map(accountOut), settings: { notifyUnknown: cfg.notifyUnknown } };
}

async function testAccount({ kind, url, password, id }) {
    if (!KINDS.includes(kind || 'bluebubbles')) throw Object.assign(new Error('Unknown account kind.'), { code: 'BAD_KIND' });
    if (kind === 'rcs') {
        const p = providers.get(id);
        if (!p) throw Object.assign(new Error('That account is not running.'), { code: 'NO_ACCOUNT' });
        const st = await p.test();
        return { identity: p.identity(), features: p.features(), paired: !!(st && st.loggedIn), connected: !!(st && st.connected) };
    }
    const pass = password || (id ? passwordFor(id) : '');
    const p = new BlueBubblesProvider({ id: id || 'test', url, password: pass }, {});
    const info = await p.test();
    p.info = info;
    return { identity: p.identity(), features: p.features(), serverVersion: info.server_version || '', osVersion: info.os_version || '', computer: info.computer_id || '' };
}

function saveAccount(input) {
    const body = input && typeof input === 'object' ? input : {};
    const kind = body.kind || 'bluebubbles';
    if (!KINDS.includes(kind)) throw Object.assign(new Error('Unknown account kind.'), { code: 'BAD_KIND' });
    const cfg = readConfig();
    let id = String(body.id || '').trim().toLowerCase();
    if (id && !ID_RE.test(id)) throw Object.assign(new Error('Bad account id.'), { code: 'BAD_ID' });
    if (!id) {
        const base = kind === 'bluebubbles' ? 'imessage' : kind;
        if (kind === 'rcs' && cfg.accounts.some((a) => a.kind === 'rcs')) throw Object.assign(new Error('There is already an RCS account.'), { code: 'EXISTS' });
        id = base;
        for (let n = 2; cfg.accounts.some((a) => a.id === id); n += 1) id = `${base}${n}`;
    }
    const url = kind === 'rcs' ? '' : normalizeUrl(body.url);
    if (kind !== 'rcs' && !url) throw Object.assign(new Error('Type the BlueBubbles server address.'), { code: 'NO_URL' });
    const row = { id, kind, url, enabled: body.enabled !== false };
    const at = cfg.accounts.findIndex((a) => a.id === id);
    // client settings: only known switches, merged over what is stored
    const allowed = kind === 'bluebubbles' ? Object.keys(BB_DEFAULTS) : ['notify'];
    const prevSettings = at >= 0 && cfg.accounts[at].settings ? cfg.accounts[at].settings : {};
    const nextSettings = Object.assign({}, prevSettings);
    if (body.settings && typeof body.settings === 'object') for (const k of allowed) if (typeof body.settings[k] === 'boolean') nextSettings[k] = body.settings[k];
    row.settings = nextSettings;
    if (at >= 0) cfg.accounts[at] = Object.assign({}, cfg.accounts[at], row);
    else cfg.accounts.push(row);
    writeConfig(cfg);
    if (body.password != null && String(body.password) !== '') writePassword(id, String(body.password));
    if (kind !== 'rcs' && !passwordFor(id)) throw Object.assign(new Error('Type the BlueBubbles server password.'), { code: 'NO_PASSWORD' });
    startAccount(row);
    broadcast({ event: 'account', accountId: id });
    return accountOut(row);
}

function deleteAccount(id) {
    const cfg = readConfig();
    cfg.accounts = cfg.accounts.filter((a) => a.id !== id);
    writeConfig(cfg);
    writePassword(id, '');
    stopAccount(id);
    try { if (storeOpen()) store.forgetAccount(id); } catch (error) { log(`store forget failed: ${error.message}`); }
    broadcast({ event: 'account', accountId: id, removed: true });
    return { ok: true };
}

function saveSettings(input) {
    const cfg = readConfig();
    if (input && typeof input.notifyUnknown === 'boolean') cfg.notifyUnknown = input.notifyUnknown;
    writeConfig(cfg);
    broadcast({ event: 'settings', settings: { notifyUnknown: cfg.notifyUnknown } });
    return { notifyUnknown: cfg.notifyUnknown };
}

async function listChats(accountId, { folder = 'all', limit = 50, offset = 0 } = {}) {
    const p = provider(accountId);
    // a folder holds only part of the conversations: read deeper so it can fill a page
    const scan = folder === 'all' ? 0 : 400;
    const [chats, ds] = await Promise.all([p.listChats({ limit: folder === 'all' ? Math.min(Number(limit) || 50, 200) : 300, offset: folder === 'all' ? Number(offset) || 0 : 0, scan }), dreamscapeContacts()]);
    for (const c of chats) { decorateParticipants(c, ds); c.known = isKnownChat(accountId, c, ds); applyReadMark(accountId, c); }
    await countUnread(accountId, chats);
    if (!offset) {
        // unread messages (as e-mail counts them), not conversations
        const sum = (list) => list.reduce((n, c) => n + (c.unread ? Math.max(1, Number(c.unreadCount) || 1) : 0), 0);
        const value = { unread: sum(chats.filter((c) => c.known)), unknownUnread: sum(chats.filter((c) => !c.known)) };
        summaries.set(accountId, { at: Date.now(), value });
    }
    if (folder === 'all') return { chats, more: chats.length >= (Number(limit) || 50) };
    const all = folder === 'inbox' ? chats.filter((c) => c.known) : chats.filter((c) => !c.known);
    const from = Number(offset) || 0;
    const n = Math.min(Number(limit) || 50, 200);
    return { chats: all.slice(from, from + n), more: all.length > from + n };
}

/** Unread counts for every account (pickers, Today, tray), cached briefly. */
async function summary() {
    const out = [];
    for (const a of readConfig().accounts) {
        const p = providers.get(a.id);
        if (!p || p.status !== 'connected') { out.push(accountOut(a)); continue; }
        const s = summaries.get(a.id);
        if (!s || Date.now() - s.at > SUMMARY_TTL_MS) {
            try { await listChats(a.id, { limit: 100 }); } catch (_) { /* stays null */ }
        }
        out.push(accountOut(a));
    }
    return out;
}

// ---- keeping the copy honest: the source wins ----
const VERIFY_EVERY_MS = 60 * 1000;
const RECONCILE_EVERY_MS = 15 * 60 * 1000;
const verifiedAt = new Map(); // "<account>|<chat>" -> ms

/** After a read from the copy: the conversation's newest page from the source, in the background. */
function verifySoon(accountId, chatGuid) {
    const p = providers.get(accountId);
    if (!p || typeof p.verifyChat !== 'function' || p.status !== 'connected') return;
    const key = `${accountId}|${chatGuid}`;
    if (Date.now() - (verifiedAt.get(key) || 0) < VERIFY_EVERY_MS) return;
    verifiedAt.set(key, Date.now());
    p.verifyChat(chatGuid).then((changed) => {
        if (changed) { summaries.delete(accountId); broadcast({ event: 'reload', accountId, chatGuid }); }
    }, (error) => log(`verify ${accountId} failed: ${error.message}`));
}

let reconcileTimer = null;
function scheduleReconcile() {
    if (reconcileTimer) return;
    const run = async () => {
        for (const [id, p] of providers) {
            if (p.status !== 'connected' || typeof p.reconcile !== 'function') continue;
            try {
                const r = await p.reconcile();
                if (r && !r.inSync) log(`${id} out of sync: ${JSON.stringify(r)}`);
                if (r) broadcast({ event: 'sync', accountId: id });
            } catch (error) { log(`reconcile ${id} failed: ${error.message}`); }
        }
    };
    reconcileTimer = setInterval(run, RECONCILE_EVERY_MS);
    if (reconcileTimer.unref) reconcileTimer.unref();
    const first = setTimeout(run, 3 * 60 * 1000);
    if (first.unref) first.unref();
}

function dirSize(dir) {
    let n = 0;
    try { for (const f of fs.readdirSync(dir)) { try { n += fs.statSync(path.join(dir, f)).size; } catch (_) { /* gone */ } } } catch (_) { /* none */ }
    return n;
}

/** Sync status and storage for the status page (CardSpace's cards, Melaton Messenger). */
function syncStatus() {
    const accounts = readConfig().accounts.map((a) => {
        const p = providers.get(a.id);
        let reconcile = null;
        let drift = null;
        try { reconcile = JSON.parse(store.getState(a.id, 'reconcile') || 'null'); } catch (_) { reconcile = null; }
        try { drift = JSON.parse(store.getState(a.id, 'drift') || 'null'); } catch (_) { drift = null; }
        const push = p ? (p.kind === 'bluebubbles' ? !!(p.socket && p.socket.connected) : !!(p.child && p.status === 'connected')) : false;
        return { id: a.id, name: accountOut(a).name, kind: a.kind, status: p ? p.status : 'disabled', sync: syncInfo(a.id, p), reconcile, drift, push, lastPush: lastPush.get(a.id) || null };
    });
    let cacheDir = null;
    try { cacheDir = resources().getPath('cache'); } catch (_) { cacheDir = path.join(__dirname, '..', '.cache'); }
    return { accounts, storage: { database: storeOpen() ? store.sizeOnDisk() : 0, attachments: dirSize(path.join(cacheDir, 'textmessaging-attachments')) } };
}

/** Every conversation of an account in the server's copy: title, newest date, synced, messages held. */
function syncChats(accountId) {
    const p = provider(accountId);
    if (!storeOpen()) return { chats: [] };
    const complete = p.kind === 'bluebubbles' ? store.getState(accountId, 'complete') === '1' : false;
    const chats = store.chatSyncRows(accountId).map((r) => {
        let chat = null;
        try { chat = p.normalizeChat(r.raw); } catch (_) { chat = null; }
        return { guid: r.guid, title: chat ? chat.title : r.guid, service: chat ? chat.service : '', lastDate: r.lastDate, synced: r.synced || complete, messages: r.messages, updated: r.updated };
    });
    return { chats };
}

/** Resync now (catch up and reconcile), or rebuild from the source (the copy is dropped and pulled again). */
async function resync(accountId, { rebuild = false } = {}) {
    const p = provider(accountId);
    if (rebuild && storeOpen()) store.forgetAccount(accountId);
    if (typeof p.startSync === 'function') p.startSync();
    if (!rebuild && typeof p.reconcile === 'function') p.reconcile().then(() => broadcast({ event: 'sync', accountId }), () => {});
    broadcast({ event: 'account', accountId });
    return { ok: true };
}

async function listMessages(accountId, chatGuid, opts) {
    const p = provider(accountId);
    verifySoon(accountId, chatGuid);
    const [page, ds] = await Promise.all([p.listMessages(chatGuid, opts || {}), dreamscapeContacts()]);
    for (const m of page.messages) if (m.sender && !m.sender.me && !m.sender.name) { const n = ds.get(handleKey(m.sender.address)); if (n) m.sender.name = n; }
    return page;
}

async function getChat(accountId, chatGuid) {
    const p = provider(accountId);
    const [chat, ds] = await Promise.all([p.getChat(chatGuid), dreamscapeContacts()]);
    if (chat) { decorateParticipants(chat, ds); chat.known = isKnownChat(accountId, chat, ds); applyReadMark(accountId, chat); await countUnread(accountId, [chat]); }
    return chat;
}

async function send(accountId, args) {
    const p = provider(accountId);
    const res = await p.sendText(Object.assign({ tempGuid: args.tempGuid || `temp-${randomUUID()}` }, args));
    if (res.chatGuid) markWritten(accountId, res.chatGuid);
    summaries.delete(accountId);
    return res;
}

async function sendAttachment(accountId, args) {
    const p = provider(accountId);
    const res = await p.sendAttachment(args);
    if (res.chatGuid) markWritten(accountId, res.chatGuid);
    return res;
}

/** RCS: a QR code for Google Messages > Device pairing ('pairing' events follow: { qr } then { paired }). */
async function pair(accountId) { return provider(accountId).pair(); }
/**
 * The Google sign-in for RCS pairing, taken from Alchemy (Dreamscape's server browser, CDP on 127.0.0.1
 * ALCHEMY_CDP_PORT, default 9339) when the owner presses Continue on the RCS card after signing in at
 * messages.google.com in the private window CardSpace opens (an isolated browser context of its own).
 * A browser must never keep presenting the session the bridge got: Google rotates a session's bound
 * cookies in the browser, and a copy the bridge keeps presenting beside them reads as stolen, so Google
 * signs the session out everywhere (the bridge and Alchemy's own Google sign-in both went on Nov 13 2026).
 * So once read, the sign-in leaves Alchemy without a sign-out (that would end it for the bridge too): a
 * private context is disposed; from the profile (the normal window, where 1Password's extension runs;
 * private contexts have no extensions) every google.com cookie is expired. Only the cookies the pairing
 * needs leave Alchemy, straight to the bridge; nothing is logged or stored here.
 */
const GOOGLE_COOKIES = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'OSID', '__Secure-1PSIDTS', '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID', 'NID'];
function alchemyGoogleCookies() {
    const port = Math.max(0, Number(process.env.ALCHEMY_CDP_PORT || 9339) || 0);
    if (!port) return Promise.reject(Object.assign(new Error('Alchemy has no debugging port.'), { code: 'NO_ALCHEMY' }));
    const http = require('http');
    const WebSocket = require('ws');
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                let url;
                try { url = JSON.parse(body).webSocketDebuggerUrl; } catch (_) { url = null; }
                if (!url) { reject(Object.assign(new Error('Alchemy is not running.'), { code: 'NO_ALCHEMY' })); return; }
                const ws = new WebSocket(url, { perMessageDeflate: false });
                let nextId = 1;
                const waiting = new Map();
                const send = (method, params) => new Promise((ok, fail) => {
                    const id = nextId++;
                    waiting.set(id, { ok, fail });
                    ws.send(JSON.stringify({ id, method, params: params || {} }));
                });
                const timer = setTimeout(() => { try { ws.terminate(); } catch (_) { /* gone */ } reject(Object.assign(new Error('Alchemy did not answer.'), { code: 'NO_ALCHEMY' })); }, 10000);
                ws.on('error', (e) => { clearTimeout(timer); reject(Object.assign(new Error(`Alchemy: ${e.message}`), { code: 'NO_ALCHEMY' })); });
                ws.on('message', (raw) => {
                    let m;
                    try { m = JSON.parse(raw); } catch (_) { return; }
                    const w = m.id != null && waiting.get(m.id);
                    if (!w) return;
                    waiting.delete(m.id);
                    if (m.error) w.fail(new Error(m.error.message || 'CDP error')); else w.ok(m.result || {});
                });
                ws.on('open', async () => {
                    try {
                        const { browserContextIds = [] } = await send('Target.getBrowserContexts');
                        let found = null;
                        // private contexts first, the profile ('') last
                        for (const ctx of [...browserContextIds, '']) {
                            if (found) break;
                            const r = await send('Storage.getCookies', ctx ? { browserContextId: ctx } : {});
                            const out = {};
                            for (const c of r.cookies || []) {
                                const d = String(c.domain || '');
                                if (!GOOGLE_COOKIES.includes(c.name)) continue;
                                if (c.name === 'OSID' ? !/messages\.google\.com$/.test(d) : d !== '.google.com') continue;
                                out[c.name] = c.value;
                            }
                            if (out.SID && out.SAPISID) found = { ctx, cookies: out, all: r.cookies || [] };
                        }
                        // the sign-in is the bridge's from here: no browser may present it again
                        if (found && found.ctx) await send('Target.disposeBrowserContext', { browserContextId: found.ctx }).catch(() => {});
                        else if (found) {
                            for (const c of found.all) {
                                const d = String(c.domain || '');
                                if (!/(^|\.)google\.com$/.test(d.replace(/^\./, ''))) continue;
                                const gone = { name: c.name, value: '', path: c.path || '/', expires: 1, secure: !!c.secure };
                                if (d.startsWith('.')) gone.domain = d; else gone.url = 'https://' + d + (c.path || '/');
                                if (c.partitionKey) gone.partitionKey = c.partitionKey;
                                await send('Storage.setCookies', { cookies: [gone] }).catch(() => {});
                            }
                        }
                        clearTimeout(timer);
                        try { ws.close(); } catch (_) { /* gone */ }
                        resolve(found ? found.cookies : {});
                    } catch (error) {
                        clearTimeout(timer);
                        try { ws.close(); } catch (_) { /* gone */ }
                        reject(Object.assign(new Error(`Alchemy: ${error.message}`), { code: 'NO_ALCHEMY' }));
                    }
                });
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => reject(Object.assign(new Error('Alchemy is not running.'), { code: 'NO_ALCHEMY' })));
    });
}

/** RCS by Google account: the sign-in from Alchemy, then { emoji } to tap on the phone. */
async function pairGoogle(accountId) {
    const p = provider(accountId);
    if (typeof p.pairGoogle !== 'function') throw Object.assign(new Error('Not an RCS account.'), { code: 'BAD_KIND' });
    const cookies = await alchemyGoogleCookies();
    if (!cookies.SID || !cookies.SAPISID) throw Object.assign(new Error('Alchemy is not signed in to Google. Press Open Alchemy, sign in at Google Messages there, then press Continue.'), { code: 'NOT_SIGNED_IN' });
    return p.pairGoogle(cookies);
}

/** A contact's picture for the lists (JPEG bytes) or null. */
function avatar(accountId, key) {
    const p = providers.get(String(accountId || ''));
    return p && typeof p.contactAvatar === 'function' ? p.contactAvatar(key) : null;
}

function pairingQr(accountId) { const p = providers.get(String(accountId || '')); return (p && p.qr) || ''; }
async function refreshQr(accountId) { return provider(accountId).refreshQr(); }
async function unpair(accountId) { return provider(accountId).unpair(); }

async function react(accountId, args) { return provider(accountId).react(args); }
async function edit(accountId, args) { return provider(accountId).edit(args); }
async function unsend(accountId, args) { return provider(accountId).unsend(args); }
async function markRead(accountId, args) {
    summaries.delete(accountId);
    markChatRead(accountId, args && args.chatGuid);
    return provider(accountId).markRead(args);
}
/**
 * Search the text of messages in every connected account (or one): newest first, each with its
 * account, conversation title and whether the conversation is known (Inbox) or Unknown Senders.
 */
async function search(q, { accountId = null, limit = 40 } = {}) {
    const term = String(q || '').trim();
    if (term.length < 2) return { results: [] };
    const ds = await dreamscapeContacts();
    const out = [];
    for (const a of readConfig().accounts) {
        if (accountId && a.id !== accountId) continue;
        const p = providers.get(a.id);
        if (!p || p.status !== 'connected' || typeof p.searchMessages !== 'function') continue;
        let found = [];
        try { found = await p.searchMessages(term, { limit }); } catch (error) { log(`search ${a.id} failed: ${error.message}`); continue; }
        const titles = new Map();
        for (const m of found) {
            if (m.sender && !m.sender.me && !m.sender.name) { const n = ds.get(handleKey(m.sender.address)); if (n) m.sender.name = n; }
            if (!titles.has(m.chatGuid)) {
                let chat = null;
                try { chat = await getChat(a.id, m.chatGuid); } catch (_) { chat = null; }
                titles.set(m.chatGuid, chat);
            }
            const chat = titles.get(m.chatGuid);
            out.push({ accountId: a.id, account: accountOut(a).name, chatGuid: m.chatGuid, chatTitle: chat ? chat.title : (m.sender && (m.sender.name || m.sender.address)) || '', known: chat ? chat.known !== false : true, message: m });
        }
    }
    out.sort((x, y) => (y.message.date || 0) - (x.message.date || 0));
    return { results: out.slice(0, limit) };
}

async function deleteChat(accountId, args) {
    const p = provider(accountId);
    if (typeof p.deleteChat !== 'function') throw Object.assign(new Error('This account cannot delete conversations.'), { code: 'UNSUPPORTED' });
    await p.deleteChat(args);
    summaries.delete(accountId);
    broadcast({ event: 'chat', accountId, chatGuid: args && args.chatGuid, deleted: true });
    return { ok: true };
}

async function markUnread(accountId, args) {
    summaries.delete(accountId);
    markChatUnread(accountId, args && args.chatGuid);
    const p = provider(accountId);
    if (typeof p.markUnread === 'function') { try { await p.markUnread(args); } catch (_) { /* kept here anyway */ } }
    broadcast({ event: 'read', accountId, chatGuid: args && args.chatGuid, read: false });
    return { ok: true };
}

async function typing(accountId, args) { return provider(accountId).typing(args); }
async function downloadAttachment(accountId, guid, opts) { return provider(accountId).downloadAttachment(guid, opts); }

async function resolveName(accountId, address) {
    const p = providers.get(accountId);
    if (p && p.loadContacts) { await p.loadContacts().catch(() => {}); const n = p.contactName(address); if (n) return n; }
    const ds = await dreamscapeContacts();
    return ds.get(handleKey(address)) || '';
}

function _reset() {
    for (const id of [...providers.keys()]) stopAccount(id);
    started = false;
    knownChats = null;
    readMarks = null;
    dsContacts = { at: 0, keys: new Map(), promise: null };
    listeners.clear();
}

module.exports = {
    init, onEvent, listAccounts, testAccount, saveAccount, deleteAccount, saveSettings, summary,
    listChats, getChat, listMessages, send, sendAttachment, react, edit, unsend, markRead, markUnread, deleteChat, search, typing, syncStatus, syncChats, resync,
    downloadAttachment, resolveName, handleKey, pair, pairGoogle, refreshQr, unpair, pairingQr, avatar, _reset
};
