/**
 * A contact card for every chat persona (Yozora #763).
 *
 * A chat persona (a chat_sessions row in chat.db, made by create_chat_session from the desktop chat
 * or the phone's Text Messages) gets a vCard in a workspace's Contacts folder, the folder Melaton
 * Contacts (apps/contacts, explorerContacts.js) and the phone's Contacts (wmNotes.js) read:
 *
 *   FN / N        the persona's name (N holds it whole as the given name, so "File as" is the name)
 *   PHOTO         the gallery picture of the chat, a 192 px JPEG from the middle
 *   CATEGORIES    Chat Personas
 *   X-DREAMSCAPE-CHAT-ID       the chat (chat_sessions.id): Contacts opens the chat from it
 *   X-DREAMSCAPE-CHAT-NAME     the persona name last written here; a name the person typed into
 *                              the card (FN no longer equal to it) is kept when the persona renames
 *   X-DREAMSCAPE-CHAT-DELETED  set when the chat is deleted: the card stays (it is the person's
 *                              contact, maybe edited or grouped) and Contacts stops offering Chat
 *
 * Which workspace: the one the creating client is on (workspaceManager.getActiveWorkspace of its
 * session), or data.workspace when the client names one. A chat has no workspace of its own, so
 * the card is looked up in every workspace's Contacts folder by its X-DREAMSCAPE-CHAT-ID.
 *
 * The persona's state is not written into the card on every message: getPersonaState(chatId)
 * reads it from chat.db when a card is opened (WS get_chat_persona_state,
 * modules/ws/handlers/52-chatPersonaContactsHandler.js): the newest emotion (with intensity),
 * trust level, location, time of day, environment, current plan, future plans, inventory, the
 * last message time and the weightiest memories.
 *
 * backfill({ workspaceId }) makes the cards of the chats that have none (a one-off for chats made
 * before this): every card goes to that one workspace.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vfsDatabase = require('./vfsDatabase');
const { md5HexAsync, writeFileIfMissing } = require('./vfsPerfHelpers');
const VC = require('../public/scripts/comp/vcard.js');

const CATEGORY = 'Chat Personas';
const FOLDER = 'Contacts';
const PHOTO_SIDE = 192;
const STATE_TYPES = ['emotion', 'trustlevel', 'location', 'timeofday', 'environment', 'currplan', 'futureplans', 'inventory', 'myname'];
const TOP_MEMORIES = 5;

let gr = null;
function resources() {
    if (!gr) gr = require('./globalResources');
    return gr;
}

// chatId -> { workspaceId, fileId } of its card (filled by the scans; checked again before use)
const index = new Map();
let scanned = false;
let lastScan = 0;
const RESCAN_MS = 60 * 1000;
let chain = Promise.resolve();

/** One card write at a time: a create racing a rename must not make two cards. */
function serial(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
}

function workspaces() {
    try { return resources().getWorkspaceManager().getWorkspaces() || {}; } catch (_) { return {}; }
}

/** The workspace a client's new persona's card goes to. */
function workspaceForClient(clientInfo, wanted) {
    const all = workspaces();
    if (wanted && all[wanted]) return wanted;
    let id = null;
    try {
        if (clientInfo && clientInfo.sessionId) id = resources().getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
    } catch (_) { id = null; }
    if (id && all[id]) return id;
    if (all.default) return 'default';
    return Object.keys(all)[0] || null;
}

function personaName(session, latestName) {
    const n = String((session && (session.chat_name || session.character_name)) || latestName || '').trim();
    return n || 'Chat Persona';
}

async function contactsFolder(workspaceId, create) {
    const vfs = resources().getVfsManager();
    const found = await vfs._findWorkspaceFolderByName(workspaceId, null, FOLDER, { excludeDesktop: true });
    if (found || !create) return found || null;
    return vfs.createFolderAtPath(`/Workspaces/${workspaceId}`, FOLDER);
}

async function readCardFile(file) {
    const vfs = resources().getVfsManager();
    const text = await fs.promises.readFile(vfs.getFileBlobPath(file.content_hash), 'utf8');
    return VC.parseVcf(text);
}

async function vcfFiles(workspaceId) {
    const folder = await contactsFolder(workspaceId, false);
    if (!folder) return { folder: null, files: [] };
    const files = await vfsDatabase.getUserFilesByLocation('workspace', workspaceId, folder.id);
    return { folder, files: (files || []).filter((f) => /\.vcf$/i.test(f.original_name || '')) };
}

/** Every persona card in every workspace's Contacts folder, into the index. */
async function scanAll() {
    index.clear();
    for (const workspaceId of Object.keys(workspaces())) {
        let listing;
        try { listing = await vcfFiles(workspaceId); } catch (_) { continue; }
        for (const file of listing.files) {
            let cards;
            try { cards = await readCardFile(file); } catch (_) { continue; }
            const c = cards[0];
            if (c && c.chatId && !index.has(String(c.chatId))) index.set(String(c.chatId), { workspaceId, fileId: file.id });
        }
    }
    scanned = true;
    lastScan = Date.now();
}

/** The card of a chat: { workspaceId, file, cards, card } or null. */
async function findCard(chatId) {
    const key = String(chatId);
    for (let pass = 0; pass < 2; pass += 1) {
        // a miss scans again, at most once a minute (syncName runs after every reply)
        if (!scanned) await scanAll();
        else if (pass === 1) { if (Date.now() - lastScan < RESCAN_MS) return null; await scanAll(); }
        const hit = index.get(key);
        if (!hit) continue;
        const file = await vfsDatabase.getUserFileById(hit.fileId);
        if (!file || file.trashed_at) { index.delete(key); continue; }
        let cards;
        try { cards = await readCardFile(file); } catch (_) { index.delete(key); continue; }
        if (!cards[0] || String(cards[0].chatId) !== key) { index.delete(key); continue; }
        return { workspaceId: hit.workspaceId, file, cards, card: cards[0] };
    }
    return null;
}

function broadcast(workspaceId) {
    try {
        require('./vfsFuseHttp').invalidateFuseLookupCache();
    } catch (_) { /* no FUSE mount */ }
    const ws = resources().getWebSocketServer && resources().getWebSocketServer();
    if (ws && ws.broadcast) {
        ws.broadcast({ type: 'vfs_updated', data: { path: `/Workspaces/${workspaceId}/${FOLDER}` }, timestamp: new Date().toISOString() });
    }
}

/** The gallery picture as a square JPEG data URL, or '' when it cannot be read. */
async function photoFor(filename) {
    if (!filename) return '';
    try {
        const base = resources().getPath('images');
        const file = path.resolve(base, String(filename));
        if (!file.startsWith(path.resolve(base) + path.sep)) return '';
        const sharp = require('sharp');
        const buf = await sharp(file).rotate().resize(PHOTO_SIDE, PHOTO_SIDE, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82 }).toBuffer();
        return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (_) {
        return '';
    }
}

function setName(c, name) {
    c.fn = name;
    c.first = name;
    c.middle = '';
    c.last = '';
    c.chatName = name;
}

async function writeNewCard(workspaceId, c) {
    const vfs = resources().getVfsManager();
    const folder = await contactsFolder(workspaceId, true);
    const existing = await vfsDatabase.getUserFilesByLocation('workspace', workspaceId, folder.id);
    const used = new Set((existing || []).map((f) => String(f.original_name || '').toLowerCase()));
    const base = VC.displayName(c).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 80) || 'Contact';
    let name = `${base}.vcf`;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} (${n}).vcf`;
    const file = await vfs.saveUserFileBuffer(Buffer.from(VC.toVcf(c), 'utf8'), {
        originalName: name,
        mimeType: 'text/vcard',
        scope: 'workspace',
        workspaceId,
        folderId: folder.id
    });
    if (file && c.chatId) index.set(String(c.chatId), { workspaceId, fileId: file.id });
    broadcast(workspaceId);
    return file;
}

/** Write a card file again in place (the same file id, as vfs_replace_file does). */
async function rewriteCard(found) {
    const vfs = resources().getVfsManager();
    const buffer = Buffer.from(found.cards.map((x) => VC.toVcf(x)).join(''), 'utf8');
    const hash = await md5HexAsync(buffer);
    const oldHash = found.file.content_hash;
    await writeFileIfMissing(vfs.getFileBlobPath(hash), buffer);
    await vfsDatabase.updateUserFile(found.file.id, { content_hash: hash, size: buffer.length });
    if (oldHash && oldHash !== hash && typeof vfs._gcContentBlobIfUnreferenced === 'function') {
        try { await vfs._gcContentBlobIfUnreferenced(oldHash); } catch (_) { /* the old blob stays */ }
    }
    broadcast(found.workspaceId);
}

/** The card of a new persona (nothing when the chat has one already). Returns { created, fileId, workspaceId }. */
function ensureContact(chatId, workspaceId) {
    return serial(async () => {
        const chatDb = resources().getChatDatabase();
        const session = await chatDb.getChatSession(chatId);
        if (!session) return { created: false, reason: 'no chat' };
        const have = await findCard(chatId);
        if (have) return { created: false, fileId: have.file.id, workspaceId: have.workspaceId };
        if (!workspaceId || !workspaces()[workspaceId]) return { created: false, reason: 'no workspace' };
        let latestName = '';
        try {
            const rows = await chatDb.getPersonaStateRows(chatId, ['myname'], 0);
            const n = rows.latest.find((r) => r.event_type === 'myname');
            latestName = n ? String(n.content || '').trim() : '';
        } catch (_) { /* no name event */ }
        const c = VC.blank();
        setName(c, personaName(session, latestName));
        c.photo = await photoFor(session.filename);
        c.categories = [CATEGORY];
        c.chatId = String(chatId);
        const file = await writeNewCard(workspaceId, c);
        return { created: true, fileId: file && file.id, workspaceId };
    });
}

/**
 * The persona's name changed (Contacts' rename, or the persona's own myname): the card follows,
 * unless the person typed another name into the card.
 */
function syncName(chatId) {
    return serial(async () => {
        const session = await resources().getChatDatabase().getChatSession(chatId);
        if (!session) return false;
        const name = String(session.chat_name || session.character_name || '').trim();
        if (!name) return false;
        const found = await findCard(chatId);
        if (!found) return false;
        const c = found.card;
        if (c.chatName === name) return false;
        const typed = c.fn && c.chatName && c.fn !== c.chatName;
        if (typed) c.chatName = name;
        else setName(c, name);
        await rewriteCard(found);
        return true;
    });
}

/** The chat was deleted: the card stays, marked. */
function markDeleted(chatId) {
    return serial(async () => {
        const found = await findCard(chatId);
        if (!found || found.card.chatDeleted) return false;
        found.card.chatDeleted = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        await rewriteCard(found);
        return true;
    });
}

/**
 * One-off: a card for every chat that has none, all into workspaceId. dryRun lists them only.
 * Returns { workspaceId, created: [{ chatId, name, fileId }], skipped: [{ chatId, reason }] }.
 */
async function backfill({ workspaceId, dryRun = false } = {}) {
    if (!workspaceId || !workspaces()[workspaceId]) throw new Error(`Unknown workspace: ${workspaceId || ''}`);
    await serial(scanAll);
    const sessions = await resources().getChatDatabase().getAllChatSessions();
    const out = { workspaceId, created: [], skipped: [] };
    for (const s of sessions || []) {
        if (index.has(String(s.id))) { out.skipped.push({ chatId: s.id, reason: 'has a card' }); continue; }
        if (dryRun) { out.created.push({ chatId: s.id, name: personaName(s), fileId: null }); continue; }
        try {
            const r = await ensureContact(s.id, workspaceId);
            if (r.created) out.created.push({ chatId: s.id, name: personaName(s), fileId: r.fileId });
            else out.skipped.push({ chatId: s.id, reason: r.reason || 'has a card' });
        } catch (err) {
            out.skipped.push({ chatId: s.id, reason: (err && err.message) || String(err) });
        }
    }
    return out;
}

function parseMeta(raw) {
    if (!raw) return {};
    try { const m = JSON.parse(raw); return m && typeof m === 'object' ? m : {}; } catch (_) { return {}; }
}

/** "guarded but intrigued - 20" -> { text, value: 20 } (the number the persona gives, 0-100). */
function splitTrust(text) {
    const t = String(text || '').trim();
    const m = /(?:^|[\s:(\-–—])(-?\d{1,3})(?:\s*(?:\/\s*100|%))?\s*\)?\s*$/.exec(t);
    if (!m) return { text: t, value: null };
    const value = Math.max(0, Math.min(100, Number(m[1])));
    const words = t.slice(0, m.index).replace(/[\s:(\-–—,]+$/, '').trim();
    return { text: words || t, value };
}

const iso = (sec) => (sec ? new Date(Number(sec) * 1000).toISOString() : null);

/** The persona's state for its card, from chat.db. */
async function getPersonaState(chatId) {
    const chatDb = resources().getChatDatabase();
    const session = await chatDb.getChatSession(chatId);
    if (!session) return { exists: false, chatId: String(chatId) };
    const rows = await chatDb.getPersonaStateRows(chatId, STATE_TYPES, 200);
    const by = {};
    for (const r of rows.latest) by[r.event_type] = r;
    const text = (t) => (by[t] ? String(by[t].content || '').trim() : '');
    const emotionMeta = by.emotion ? parseMeta(by.emotion.event_metadata) : {};
    const trust = splitTrust(text('trustlevel'));
    const memories = rows.memories.map((m, order) => ({ content: String(m.content || '').trim(), weight: Number(parseMeta(m.event_metadata).weight) || 0, at: iso(m.created_at), order }))
        .filter((m) => m.content);
    // the weightiest first, the newer of two the same; no repeats (a turn can restate one)
    const seen = new Set();
    const top = memories.sort((a, b) => b.weight - a.weight || a.order - b.order)
        .filter((m) => { const k = m.content.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, TOP_MEMORIES)
        .map(({ content, weight, at }) => ({ content, weight, at }));
    const st = rows.stats || {};
    return {
        exists: true,
        chatId: String(session.id),
        name: personaName(session, text('myname')),
        filename: session.filename,
        createdAt: iso(session.created_at),
        emotion: text('emotion'),
        emotionIntensity: emotionMeta.intensity !== undefined && emotionMeta.intensity !== null ? Number(emotionMeta.intensity) : null,
        trust: trust.text,
        trustValue: trust.value,
        location: text('location'),
        timeOfDay: text('timeofday'),
        environment: text('environment'),
        currentPlan: text('currplan'),
        futurePlans: text('futureplans'),
        inventory: text('inventory'),
        lastSeen: iso(st.last_assistant_at || st.last_at),
        lastMessageAt: iso(st.last_at),
        messageCount: Number(st.count) || 0,
        memories: top
    };
}

/** Tests: forget the index (a fresh scan next time). */
function _reset() {
    index.clear();
    scanned = false;
    lastScan = 0;
}

module.exports = {
    CATEGORY,
    workspaceForClient,
    ensureContact,
    syncName,
    markDeleted,
    backfill,
    getPersonaState,
    splitTrust,
    _reset
};
