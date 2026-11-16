'use strict';

// Ledge: desks of images an agent throws prints onto (MCP tool `ledge`, modules/mcpAgentFacade.js).
//
// Desks belong to one user (the client's userType: 'admin' is the household) and one workspace. A
// user never reads or gets another user's desks. They are kept in .cache/ledge/<user>.json, so they
// survive a server restart; nothing is written until the module is bound to the server (tests stay
// in memory).
//
// Director prints go to one desk per Director chat (id prints_<chatId>, named after the chat),
// capped at PRINTS_CAP items (the oldest go).
//
// Delivery (Yukimi 2026-11-16): a desk is shown only on its owner client, the tab or phone the
// Director session that writes to it belongs to (the client its MCP key is bound to). Every other
// client gets nothing. ledge_state goes to that one socket; see deliver().
//
// ledge_state data (client: public/scripts/comp/ledgeDesk.js):
//   every packet: reason, sessionId, name, workspaceId, kind ('prints'|'desk'), chatId, rev, count,
//                 ownerClientId, present (true: bring the desk on screen)
//   full desk (reason 'open' or 'sync'): items [{ index, id, filename, text, checked, src, addedAt }],
//                 checked [itemId]
//   deltas build on baseRev (the rev the client must hold, else it asks ledge_get):
//     'add'     added [item] (index = where it went), trimmed [itemId] (dropped by the cap)
//     'remove'  removed { index, id }
//     'checks'  checked [itemId]
//     'clear'   (no items left)
//     'rename'  name
//     'dispose' disposed: true

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRINTS_CAP = 200;
const DESK_CAP = 500;
const SAVE_DELAY_MS = 400;

let gr = null;
let storeDir = null;
// user -> Map(deskId -> desk)
const users = new Map();
const dirty = new Set();
let saveTimer = null;

function bind(globalResources) {
    if (globalResources && !gr) {
        gr = globalResources;
        let base = null;
        try { base = gr.getPath ? gr.getPath('cache') : null; } catch (_) { base = null; }
        storeDir = process.env.LEDGE_DESK_DIR || path.join(base || path.join(__dirname, '..', '.cache'), 'ledge');
        loadAll();
        process.once('exit', flushSync);
    }
    return module.exports;
}

function userKey(userType) {
    const raw = String(userType || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return raw || 'admin';
}

function userOfInfo(info) {
    return userKey(info && info.userType);
}

// ---- store ----

function userFile(user) {
    return path.join(storeDir, `${userKey(user)}.json`);
}

function cleanDesk(raw, user) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    const items = Array.isArray(raw.items) ? raw.items.filter((item) => item && item.id && (item.filename || item.src)) : [];
    return {
        id: String(raw.id),
        name: String(raw.name || 'Ledge').slice(0, 80),
        user,
        workspaceId: String(raw.workspaceId || 'default'),
        kind: raw.kind === 'prints' ? 'prints' : 'desk',
        chatId: raw.chatId ? String(raw.chatId) : '',
        ownerClientId: raw.ownerClientId ? String(raw.ownerClientId) : '',
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Number(raw.updatedAt) || Date.now(),
        rev: Number(raw.rev) || 1,
        items: items.map((item) => ({
            id: String(item.id),
            filename: String(item.filename || ''),
            text: String(item.text || ''),
            src: String(item.src || ''),
            checked: item.checked === true,
            addedAt: Number(item.addedAt) || 0
        }))
    };
}

function loadUser(user) {
    const map = new Map();
    users.set(user, map);
    if (!storeDir) return map;
    try {
        const parsed = JSON.parse(fs.readFileSync(userFile(user), 'utf8'));
        (Array.isArray(parsed && parsed.desks) ? parsed.desks : []).forEach((raw) => {
            const desk = cleanDesk(raw, user);
            if (desk) map.set(desk.id, desk);
        });
    } catch (err) {
        if (err && err.code !== 'ENOENT') console.warn(`[ledge] could not read ${userFile(user)}: ${err.message}`);
    }
    return map;
}

function loadAll() {
    if (!storeDir) return;
    let names = [];
    try { names = fs.readdirSync(storeDir).filter((name) => /^[a-z0-9_-]+\.json$/.test(name)); } catch (_) { names = []; }
    names.forEach((name) => loadUser(name.slice(0, -5)));
}

function desksOf(user) {
    const key = userKey(user);
    return users.get(key) || loadUser(key);
}

function markDirty(desk) {
    desk.rev += 1;
    desk.updatedAt = Date.now();
    if (!storeDir) return;
    dirty.add(desk.user);
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        flushSync();
    }, SAVE_DELAY_MS);
    if (saveTimer.unref) saveTimer.unref();
}

function flushSync() {
    if (!storeDir || !dirty.size) return;
    const list = [...dirty];
    dirty.clear();
    try { fs.mkdirSync(storeDir, { recursive: true }); } catch (_) { /* written below or logged */ }
    list.forEach((user) => {
        const map = users.get(user);
        if (!map) return;
        const file = userFile(user);
        const tmp = `${file}.${process.pid}.tmp`;
        try {
            const body = { version: 1, user, savedAt: new Date().toISOString(), desks: [...map.values()].map((desk) => {
                const out = Object.assign({}, desk);
                delete out.user;
                delete out.lastTrimmed;
                return out;
            }) };
            fs.writeFileSync(tmp, JSON.stringify(body));
            fs.renameSync(tmp, file);
        } catch (err) {
            console.error(`[ledge] could not save ${file}: ${err.message}`);
        }
    });
}

// ---- shapes ----

function publicItem(item, index) {
    return {
        index,
        id: item.id,
        filename: item.filename || '',
        text: item.text || '',
        checked: item.checked === true,
        src: item.src || '',
        addedAt: item.addedAt || 0
    };
}

function deskHead(desk) {
    return {
        sessionId: desk.id,
        name: desk.name,
        workspaceId: desk.workspaceId,
        kind: desk.kind,
        chatId: desk.chatId || null,
        count: desk.items.length,
        rev: desk.rev,
        updatedAt: new Date(desk.updatedAt).toISOString()
    };
}

function publicSession(desk, includeItems) {
    const out = deskHead(desk);
    out.checked = desk.items.filter((item) => item.checked).map((item) => item.id);
    if (includeItems) out.items = desk.items.map(publicItem);
    return out;
}

function snapshot(desk) {
    return {
        kind: 'ledge-session',
        sessionId: desk.id,
        name: desk.name,
        workspaceId: desk.workspaceId,
        items: desk.items.map(publicItem)
    };
}

// ---- desks ----

function listSessions(user, workspaceId) {
    const ws = workspaceId ? String(workspaceId) : '';
    return [...desksOf(user).values()]
        .filter((desk) => !ws || desk.workspaceId === ws)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((desk) => publicSession(desk, false));
}

function getSession(user, sessionId) {
    const id = String(sessionId || '').trim();
    return id ? desksOf(user).get(id) || null : null;
}

function sessionName(input) {
    return String((input && (input.name || input.title)) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// ctx: { user, workspaceId, ownerClientId }
function openSession(input, ctx) {
    const c = ctx || {};
    const map = desksOf(c.user);
    const asked = String((input && (input.sessionId || input.id)) || '').trim();
    const name = sessionName(input);
    if (asked && map.has(asked)) {
        const desk = map.get(asked);
        if (name && name !== desk.name) {
            desk.name = name;
            markDirty(desk);
        }
        if (c.ownerClientId) desk.ownerClientId = c.ownerClientId;
        return { created: false, session: desk };
    }
    if (!name) return { created: false, session: null };
    const id = asked || `ledge_${crypto.randomBytes(6).toString('hex')}`;
    const desk = {
        id,
        name,
        user: userKey(c.user),
        workspaceId: String(c.workspaceId || 'default'),
        kind: input && input.kind === 'prints' ? 'prints' : 'desk',
        chatId: input && input.chatId ? String(input.chatId) : '',
        ownerClientId: c.ownerClientId || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        rev: 0,
        items: []
    };
    map.set(id, desk);
    markDirty(desk);
    return { created: true, session: desk };
}

function normalizeItem(raw) {
    if (typeof raw === 'string') return { filename: raw.trim(), text: '', src: '' };
    if (!raw || typeof raw !== 'object') return null;
    const filename = String(raw.filename || raw.name || '').trim();
    const src = String(raw.src || raw.url || '').trim();
    const text = String(raw.text || raw.caption || raw.note || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!filename && !src) return null;
    return { filename, text, src };
}

// Returns the added items (index = where each went). desk.lastTrimmed holds the ids the cap dropped.
function addItems(desk, rawItems, index) {
    const items = (Array.isArray(rawItems) ? rawItems : [rawItems]).map(normalizeItem).filter(Boolean);
    const now = Date.now();
    const made = items.map((item) => ({
        id: crypto.randomBytes(4).toString('hex'),
        filename: item.filename,
        text: item.text,
        src: item.src,
        checked: false,
        addedAt: now
    }));
    desk.lastTrimmed = [];
    if (!made.length) return [];
    const at = index == null || index === '' ? 0 : Math.max(0, Math.min(desk.items.length, Math.trunc(Number(index)) || 0));
    if (index == null || index === '') desk.items = made.concat(desk.items);
    else desk.items.splice(at, 0, ...made);
    const cap = desk.kind === 'prints' ? PRINTS_CAP : DESK_CAP;
    if (desk.items.length > cap) desk.lastTrimmed = desk.items.splice(cap).map((item) => item.id);
    markDirty(desk);
    return made
        .map((item, i) => publicItem(item, at + i))
        .filter((item) => !desk.lastTrimmed.includes(item.id));
}

// index (a number) or an item id
function findIndex(desk, ref) {
    if (typeof ref === 'string' && !/^\d+$/.test(ref)) return desk.items.findIndex((item) => item.id === ref);
    const at = Number(ref);
    return Number.isInteger(at) && at >= 0 && at < desk.items.length ? at : -1;
}

function removeItem(desk, ref) {
    const at = findIndex(desk, ref);
    if (at < 0) return null;
    const [gone] = desk.items.splice(at, 1);
    markDirty(desk);
    return publicItem(gone, at);
}

function itemAt(desk, ref) {
    const at = findIndex(desk, ref);
    return at < 0 ? null : publicItem(desk.items[at], at);
}

function setChecks(desk, checked) {
    const on = new Set();
    if (Array.isArray(checked)) {
        checked.forEach((value) => {
            if (typeof value === 'number') {
                const item = desk.items[value];
                if (item) on.add(item.id);
            } else if (value) on.add(String(value));
        });
    }
    desk.items.forEach((item) => {
        item.checked = on.has(item.id);
    });
    markDirty(desk);
}

function clearSession(desk) {
    desk.items = [];
    markDirty(desk);
}

function disposeSession(user, sessionId) {
    const map = desksOf(user);
    const desk = map.get(String(sessionId || ''));
    if (!desk) return false;
    map.delete(desk.id);
    if (storeDir) {
        dirty.add(desk.user);
        if (!saveTimer) {
            saveTimer = setTimeout(() => { saveTimer = null; flushSync(); }, SAVE_DELAY_MS);
            if (saveTimer.unref) saveTimer.unref();
        }
    }
    return true;
}

function renameSession(desk, name) {
    const next = sessionName({ name });
    if (!next || next === desk.name) return false;
    desk.name = next;
    markDirty(desk);
    return true;
}

// ---- Director prints ----

function printsDeskId(chatId) {
    const slug = String(chatId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    return `prints_${slug || 'agent'}`;
}

/**
 * Director prints: onto the desk of the chat that made them.
 * chat: { id, name } (the Director chat, or an agent's own id and name when no chat runs)
 * ctx: { user, workspaceId, ownerClientId }
 * Returns { desk, created, added, baseRev } or null when nothing was added.
 */
function ingestGenerated(filenames, chat, ctx) {
    const names = (Array.isArray(filenames) ? filenames : [filenames]).filter(Boolean);
    if (!names.length) return null;
    const c = ctx || {};
    const chatId = String((chat && chat.id) || '').trim();
    const name = sessionName({ name: (chat && chat.name) || 'Director' }) || 'Director';
    const id = printsDeskId(chatId);
    const opened = openSession({ sessionId: id, name, kind: 'prints', chatId }, c);
    const desk = opened.session;
    // a desk made before the cap or the kind existed still counts as a prints desk
    desk.kind = 'prints';
    if (chatId) desk.chatId = chatId;
    const baseRev = opened.created ? 0 : desk.rev;
    const added = addItems(desk, names.map((filename) => ({ filename, text: '' })), 0);
    return { desk, created: opened.created, added, baseRev };
}

/** A Director chat was renamed: its prints desk follows, for every user that has one. */
function renameChatDesks(chatId, name) {
    const id = printsDeskId(chatId);
    const out = [];
    users.forEach((map) => {
        const desk = map.get(id);
        if (desk && renameSession(desk, name)) out.push(desk);
    });
    return out;
}

// ---- delivery ----

function wsServer() {
    try { return gr && gr.getWebSocketServer ? gr.getWebSocketServer() : null; } catch (_) { return null; }
}

/** The owner client's socket, when it is connected and signed in as the desk's user. */
function ownerSocket(desk) {
    const server = wsServer();
    if (!server || !server.clients || !desk || !desk.ownerClientId) return null;
    for (const [ws, info] of server.clients) {
        if (!info || info.clientId !== desk.ownerClientId) continue;
        if (ws.readyState !== 1 || info.authenticated === false) continue;
        if (userOfInfo(info) !== desk.user) continue;
        return ws;
    }
    return null;
}

function packet(desk, reason, extra) {
    return Object.assign(deskHead(desk), {
        reason,
        ownerClientId: desk.ownerClientId || null,
        present: false
    }, extra || {});
}

/** ledge_state to the desk's owner client only. Returns whether a socket took it. */
function deliver(desk, data) {
    const ws = ownerSocket(desk);
    const server = wsServer();
    if (!ws || !server || typeof server.sendToClient !== 'function') return false;
    try {
        server.sendToClient(ws, { type: 'ledge_state', data, timestamp: new Date().toISOString() });
        return true;
    } catch (_) {
        return false;
    }
}

function fullPacket(desk, reason, present) {
    return packet(desk, reason, {
        present: present === true,
        items: desk.items.map(publicItem),
        checked: desk.items.filter((item) => item.checked).map((item) => item.id)
    });
}

// ---- the MCP tool ----

function unknownSession(ctx) {
    return {
        ok: false,
        body: {
            success: false,
            error: 'Unknown Ledge session. op list shows the desks of this workspace if you forgot the id.',
            sessions: listSessions(ctx.user, ctx.workspaceId)
        }
    };
}

/**
 * The `ledge` MCP tool. ctx: { user, workspaceId, ownerClientId }. Returns { ok, body, desk?, data? };
 * data is the ledge_state packet for the owner client (null when there is nothing to send).
 */
function applyLedge(input, ctx) {
    const c = Object.assign({ user: 'admin', workspaceId: 'default', ownerClientId: '' }, ctx || {});
    const src = input && typeof input === 'object' ? input : {};
    const op = String(src.op || 'open').toLowerCase().replace(/[\s-]+/g, '_');
    if (op === 'list') {
        if (!src.sessionId) return { ok: true, body: { success: true, workspaceId: c.workspaceId, sessions: listSessions(c.user, c.workspaceId) } };
        const desk = getSession(c.user, src.sessionId);
        if (!desk) return unknownSession(c);
        return { ok: true, body: { success: true, ...publicSession(desk, true), sessions: listSessions(c.user, c.workspaceId) } };
    }
    if (op === 'open' || op === 'create') {
        const opened = openSession(src, c);
        if (!opened.session) {
            return {
                ok: false,
                body: {
                    success: false,
                    error: 'name is required when op open creates a Ledge session. The window shows "Ledge [name]". Pass an existing sessionId to reopen without a name.',
                    sessions: listSessions(c.user, c.workspaceId)
                }
            };
        }
        const desk = opened.session;
        return {
            ok: true,
            desk,
            data: fullPacket(desk, 'open', true),
            body: { success: true, created: opened.created, ...publicSession(desk, true), sessions: listSessions(c.user, c.workspaceId) }
        };
    }
    if (op === 'save_file') {
        return { ok: true, saveFile: true, body: null };
    }
    const desk = getSession(c.user, src.sessionId);
    if (!desk) return unknownSession(c);
    if (c.ownerClientId) desk.ownerClientId = c.ownerClientId;
    if (op === 'add') {
        const baseRev = desk.rev;
        const added = addItems(desk, src.items || src.item, src.index);
        if (!added.length && !(desk.lastTrimmed || []).length) {
            return { ok: false, body: { success: false, error: 'items need a filename or src', ...publicSession(desk, true) } };
        }
        return {
            ok: true,
            desk,
            data: packet(desk, 'add', { baseRev, present: true, added, trimmed: desk.lastTrimmed || [] }),
            body: { success: true, added, ...publicSession(desk, true) }
        };
    }
    if (op === 'remove') {
        const baseRev = desk.rev;
        const removed = removeItem(desk, src.itemId != null ? String(src.itemId) : src.index);
        if (!removed) return { ok: false, body: { success: false, error: 'index is out of range', ...publicSession(desk, true) } };
        return {
            ok: true,
            desk,
            data: packet(desk, 'remove', { baseRev, removed: { index: removed.index, id: removed.id } }),
            body: { success: true, removed, ...publicSession(desk, true) }
        };
    }
    if (op === 'get') {
        const item = itemAt(desk, src.itemId != null ? String(src.itemId) : src.index);
        if (!item) return { ok: false, body: { success: false, error: 'index is out of range' } };
        return { ok: true, body: { success: true, item } };
    }
    if (op === 'clear') {
        const baseRev = desk.rev;
        clearSession(desk);
        return { ok: true, desk, data: packet(desk, 'clear', { baseRev }), body: { success: true, ...publicSession(desk, true) } };
    }
    if (op === 'rename') {
        const baseRev = desk.rev;
        if (!renameSession(desk, src.name || src.title)) {
            return { ok: false, body: { success: false, error: 'name is required and must differ from the current one', ...publicSession(desk, false) } };
        }
        return { ok: true, desk, data: packet(desk, 'rename', { baseRev }), body: { success: true, ...publicSession(desk, false) } };
    }
    if (op === 'dispose') {
        const data = packet(desk, 'dispose', { disposed: true, count: 0 });
        disposeSession(c.user, desk.id);
        return {
            ok: true,
            desk,
            data,
            body: { success: true, disposed: true, sessionId: desk.id, sessions: listSessions(c.user, c.workspaceId) }
        };
    }
    if (op === 'save') {
        return { ok: true, save: true, session: desk, body: null };
    }
    return {
        ok: false,
        body: {
            success: false,
            error: 'op must be open, add, remove, get, clear, rename, list, dispose, save, or save_file',
            sessions: listSessions(c.user, c.workspaceId)
        }
    };
}

module.exports = {
    PRINTS_CAP,
    DESK_CAP,
    bind,
    userKey,
    userOfInfo,
    listSessions,
    getSession,
    openSession,
    addItems,
    removeItem,
    itemAt,
    setChecks,
    clearSession,
    disposeSession,
    renameSession,
    snapshot,
    printsDeskId,
    ingestGenerated,
    renameChatDesks,
    publicSession,
    packet,
    fullPacket,
    deliver,
    applyLedge,
    flushSync
};
