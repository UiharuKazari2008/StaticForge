'use strict';

const crypto = require('crypto');

const sessions = new Map();

function publicItem(item, index) {
    return {
        index,
        id: item.id,
        filename: item.filename || '',
        text: item.text || '',
        checked: item.checked === true,
        src: item.src || ''
    };
}

function publicSession(session, includeItems) {
    const items = session.items || [];
    const out = {
        sessionId: session.id,
        title: session.title || 'Ledge',
        count: items.length,
        checked: items.filter((item) => item.checked).map((item) => item.id)
    };
    if (includeItems) out.items = items.map(publicItem);
    return out;
}

function listSessions() {
    return [...sessions.values()].map((session) => publicSession(session, false));
}

function getSession(sessionId) {
    const id = String(sessionId || '').trim();
    return id && sessions.has(id) ? sessions.get(id) : null;
}

function openSession(input) {
    const asked = String((input && (input.sessionId || input.id)) || '').trim();
    if (asked && sessions.has(asked)) {
        const session = sessions.get(asked);
        if (input && input.title) session.title = String(input.title).slice(0, 80);
        return { created: false, session };
    }
    const id = asked || `ledge_${crypto.randomBytes(6).toString('hex')}`;
    const session = {
        id,
        title: String((input && input.title) || 'Ledge').slice(0, 80) || 'Ledge',
        items: []
    };
    sessions.set(id, session);
    return { created: true, session };
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

function addItems(session, rawItems, index) {
    const items = (Array.isArray(rawItems) ? rawItems : [rawItems]).map(normalizeItem).filter(Boolean);
    const made = items.map((item) => ({
        id: crypto.randomBytes(4).toString('hex'),
        filename: item.filename,
        text: item.text,
        src: item.src,
        checked: false
    }));
    if (!made.length) return [];
    const at = index == null || index === '' ? 0 : Math.max(0, Math.min(session.items.length, Number(index) || 0));
    if (index == null || index === '') session.items = made.concat(session.items);
    else session.items.splice(at, 0, ...made);
    return made.map((item) => publicItem(item, session.items.indexOf(item)));
}

function removeItem(session, index) {
    const at = Number(index);
    if (!Number.isInteger(at) || at < 0 || at >= session.items.length) return null;
    const [gone] = session.items.splice(at, 1);
    return publicItem(gone, at);
}

function itemAt(session, index) {
    const at = Number(index);
    if (!Number.isInteger(at) || at < 0 || at >= session.items.length) return null;
    return publicItem(session.items[at], at);
}

function setChecks(session, checked) {
    const on = new Set();
    if (Array.isArray(checked)) {
        checked.forEach((value) => {
            if (typeof value === 'number') {
                const item = session.items[value];
                if (item) on.add(item.id);
            } else if (value) on.add(String(value));
        });
    }
    session.items.forEach((item) => {
        item.checked = on.has(item.id);
    });
}

function snapshot(session) {
    return {
        kind: 'ledge-session',
        sessionId: session.id,
        title: session.title,
        items: session.items.map((item, index) => publicItem(item, index))
    };
}

function ingestGenerated(filenames) {
    const names = (Array.isArray(filenames) ? filenames : [filenames]).filter(Boolean);
    if (!names.length) return null;
    const { session } = openSession({ sessionId: 'ledge-prints', title: 'Prints' });
    addItems(session, names.map((filename) => ({ filename, text: '' })), 0);
    return session;
}

function clearSession(session) {
    session.items = [];
}

function disposeSession(sessionId) {
    sessions.delete(String(sessionId || ''));
}

function unknownSession() {
    return {
        ok: false,
        body: {
            success: false,
            error: 'Unknown Ledge session. op list shows the open desks if you forgot the id.',
            sessions: listSessions()
        }
    };
}

function applyLedge(input) {
    const src = input && typeof input === 'object' ? input : {};
    const op = String(src.op || 'open').toLowerCase().replace(/[\s-]+/g, '_');
    if (op === 'list') {
        if (!src.sessionId) return { ok: true, body: { success: true, sessions: listSessions() } };
        const session = getSession(src.sessionId);
        if (!session) return unknownSession();
        return { ok: true, body: { success: true, ...publicSession(session, true), sessions: listSessions() } };
    }
    if (op === 'open' || op === 'create') {
        const opened = openSession(src);
        const state = publicSession(opened.session, true);
        return {
            ok: true,
            reason: 'open',
            state,
            body: { success: true, created: opened.created, ...state, sessions: listSessions() }
        };
    }
    if (op === 'save_file') {
        return { ok: true, saveFile: true, body: null };
    }
    const session = getSession(src.sessionId);
    if (!session) return unknownSession();
    if (op === 'add') {
        const added = addItems(session, src.items || src.item, src.index);
        if (!added.length) {
            return { ok: false, body: { success: false, error: 'items need a filename or src', ...publicSession(session, true) } };
        }
        const state = publicSession(session, true);
        return { ok: true, reason: 'add', state, body: { success: true, added, ...state } };
    }
    if (op === 'remove') {
        const removed = removeItem(session, src.index);
        if (!removed) return { ok: false, body: { success: false, error: 'index is out of range', ...publicSession(session, true) } };
        const state = publicSession(session, true);
        return { ok: true, reason: 'remove', state, body: { success: true, removed, ...state } };
    }
    if (op === 'get') {
        const item = itemAt(session, src.index);
        if (!item) return { ok: false, body: { success: false, error: 'index is out of range' } };
        return { ok: true, body: { success: true, item } };
    }
    if (op === 'clear') {
        clearSession(session);
        const state = publicSession(session, true);
        return { ok: true, reason: 'clear', state, body: { success: true, ...state } };
    }
    if (op === 'dispose') {
        const id = session.id;
        disposeSession(id);
        return {
            ok: true,
            reason: 'dispose',
            state: { sessionId: id, disposed: true, reason: 'dispose' },
            body: { success: true, disposed: true, sessionId: id, sessions: listSessions() }
        };
    }
    if (op === 'save') {
        return { ok: true, save: true, session, body: null };
    }
    return {
        ok: false,
        body: {
            success: false,
            error: 'op must be open, add, remove, get, clear, list, dispose, save, or save_file',
            sessions: listSessions()
        }
    };
}

module.exports = {
    listSessions,
    getSession,
    openSession,
    addItems,
    removeItem,
    itemAt,
    setChecks,
    snapshot,
    ingestGenerated,
    publicSession,
    applyLedge
};
