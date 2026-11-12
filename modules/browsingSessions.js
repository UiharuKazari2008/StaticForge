'use strict';

/**
 * Browsing sessions (Yozora #756): which device owns which Internet Explorer windows and tabs.
 *
 * A client (one page load of Melaton, desktop or phone) says hello with its session id and the id of the
 * device it runs on (localStorage), then reports its IE windows and tabs as they change
 * (public/scripts/comp/browsingSessions.js). The chain is device -> client session -> IE window -> tab.
 *
 * Lifetime follows the owner, not the page (Yukimi, 2026-11-11):
 *   live    a socket of that client is connected; its Alchemy tabs are leased in the service
 *   idle    the last socket closed; the tabs stay open for idleMinutes
 *   stored  the tabs are closed in Chromium; each tab's address and history are kept for keepMinutes
 * Settings: userGlobalSettings.alchemy.sessions (modules/grimoireBrowserBridge.js normalizeSessionSettings).
 *
 * Other Devices takes a tab from another session: a live or idle Alchemy tab moves without reloading (the
 * service gives it a new viewer token and tells the old viewer), a stored one reopens at its address, and a
 * Grimoire tab is copied (the original stays). Restore Session gives a new client the sessions its device left,
 * and with "pass to the next computer" (roam) the one any device left last.
 *
 * State: .cache/browsing-sessions.json (small; written 2 s after a change).
 */

const fs = require('fs');
const path = require('path');
const bridge = require('./grimoireBrowserBridge');

const STATE_FILE = path.resolve(__dirname, '..', '.cache', 'browsing-sessions.json');
const TICK_MS = 30 * 1000;
const LEASE_TTL_MS = 3 * 60 * 1000;
const MAX_WINDOWS = 24;
const MAX_TABS = 64;
const MAX_HISTORY = 100;
const ID_RE = /^[a-z0-9_-]{8,64}$/i;
const DEVICE_RE = /^[a-f0-9]{16,32}$/;
const ALCHEMY_RE = /^[a-f0-9]{32}$/;

let state = { sessions: {} };
let loaded = false;
let saveTimer = null;
let tickTimer = null;
const sockets = new Map(); // session id -> Set<ws>

function now() {
    return Date.now();
}

function text(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, '').slice(0, max);
}

function load() {
    if (loaded) return;
    loaded = true;
    try {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (raw && raw.sessions && typeof raw.sessions === 'object') state = { sessions: raw.sessions };
    } catch (_) {
        state = { sessions: {} };
    }
    // after a Dreamscape restart nobody is connected yet: live sessions count as idle from their last report,
    // and clients that only lost the socket say hello again and are live at once
    const t = now();
    for (const session of Object.values(state.sessions)) {
        if (session.state === 'live') {
            session.state = 'idle';
            session.idleSince = Math.min(t, session.lastSeenAt || t);
        }
    }
}

function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
            const tmp = STATE_FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(state));
            fs.renameSync(tmp, STATE_FILE);
        } catch (error) {
            console.warn('[browsingSessions] save failed:', error.message);
        }
    }, 2000);
    if (saveTimer.unref) saveTimer.unref();
}

function settings() {
    try {
        return bridge.grimoireBrowserConfig().alchemy.sessions;
    } catch (_) {
        return bridge.normalizeSessionSettings({});
    }
}

// ---- shapes ----

function cleanHistory(list) {
    const out = [];
    for (const entry of Array.isArray(list) ? list.slice(-MAX_HISTORY) : []) {
        if (!entry || typeof entry !== 'object') continue;
        const url = text(entry.url || entry.address, 2000);
        if (!url) continue;
        out.push({ type: entry.type === 'web' ? 'web' : text(entry.type || 'page', 16), url, title: text(entry.title, 300) });
    }
    return out;
}

function cleanTab(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = text(raw.id, 64);
    if (!id) return null;
    const history = cleanHistory(raw.history);
    let historyIndex = Number.isInteger(raw.historyIndex) ? raw.historyIndex : history.length - 1;
    historyIndex = Math.max(-1, Math.min(history.length - 1, historyIndex));
    const top = history[historyIndex];
    const alchemyId = ALCHEMY_RE.test(String(raw.alchemyId || '')) ? String(raw.alchemyId) : '';
    return {
        id,
        kind: alchemyId || (top && top.type === 'web') ? 'alchemy' : 'grimoire',
        alchemyId,
        url: text(raw.url || (top && top.url) || '', 2000),
        title: text(raw.title || (top && top.title) || '', 300),
        icon: text(raw.icon, 2000),
        history,
        historyIndex,
        active: !!raw.active
    };
}

function cleanWindows(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list.slice(0, MAX_WINDOWS) : []) {
        if (!raw || typeof raw !== 'object') continue;
        const id = text(raw.id, 64);
        if (!id) continue;
        const tabs = (Array.isArray(raw.tabs) ? raw.tabs.slice(0, MAX_TABS) : []).map(cleanTab).filter(Boolean);
        if (!tabs.length) continue;
        out.push({ id, title: text(raw.title, 300), tabs });
    }
    return out;
}

function tabCount(session) {
    return (session.windows || []).reduce((n, win) => n + win.tabs.length, 0);
}

function alchemyIds(session) {
    const ids = [];
    for (const win of session.windows || []) {
        for (const tab of win.tabs) if (tab.alchemyId) ids.push(tab.alchemyId);
    }
    return ids;
}

function isAdmin(clientInfo) {
    // the dev login (dev_admin) is an administrator too
    return !!(clientInfo && clientInfo.authenticated && (clientInfo.userType === 'admin' || clientInfo.userType === 'dev_admin'));
}

function visibleTo(clientInfo, session) {
    if (isAdmin(clientInfo)) return true;
    return !!(clientInfo && clientInfo.browsingDevice && clientInfo.browsingDevice === session.deviceId);
}

function expiresAt(session, cfg) {
    if (session.state === 'live') return 0;
    const since = session.idleSince || session.lastSeenAt || now();
    if (session.state === 'idle') return since + cfg.idleMinutes * 60000;
    return since + cfg.keepMinutes * 60000;
}

function publicSession(session, cfg, own) {
    return {
        id: session.id,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        deviceKind: session.deviceKind,
        state: session.state,
        own: !!own,
        roaming: !!session.roaming,
        lastSeenAt: session.lastSeenAt || 0,
        idleSince: session.idleSince || 0,
        // idle: when the tabs close; stored: when the record goes
        expiresAt: expiresAt(session, cfg),
        killAt: session.state === 'idle' ? (session.idleSince || now()) + cfg.idleMinutes * 60000 : 0,
        windows: session.windows || []
    };
}

// ---- sockets ----

function send(ws, payload) {
    try {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
    } catch (_) { /* gone */ }
}

function sendToSession(id, payload) {
    for (const ws of sockets.get(id) || []) send(ws, payload);
}

/** Every connected client hears that the list changed (Other Devices refreshes while it is open). */
let changedTimer = null;
function announceChanged() {
    clearTimeout(changedTimer);
    changedTimer = setTimeout(() => {
        changedTimer = null;
        for (const set of sockets.values()) {
            for (const ws of set) send(ws, { type: 'browsing_sessions_changed', timestamp: new Date().toISOString() });
        }
    }, 1500);
    if (changedTimer.unref) changedTimer.unref();
}

// ---- operations ----

function hello(clientInfo, ws, body) {
    load();
    const id = text(body.sessionId, 64);
    const deviceId = String(body.deviceId || '').toLowerCase();
    if (!ID_RE.test(id) || !DEVICE_RE.test(deviceId)) {
        const error = new Error('bad session or device id');
        error.code = 'BAD_ID';
        throw error;
    }
    let session = state.sessions[id];
    // a session belongs to one device for good
    if (session && session.deviceId !== deviceId) {
        const error = new Error('session belongs to another device');
        error.code = 'NOT_OWNER';
        throw error;
    }
    if (!session) {
        session = state.sessions[id] = { id, deviceId, createdAt: now(), windows: [] };
    }
    session.deviceName = text(body.deviceName, 80) || session.deviceName || 'Computer';
    session.deviceKind = body.deviceKind === 'mobile' ? 'mobile' : 'desktop';
    session.state = 'live';
    session.idleSince = 0;
    session.roaming = false;
    session.dismissed = false;
    session.lastSeenAt = now();
    clientInfo.browsingSession = id;
    clientInfo.browsingDevice = deviceId;
    if (!sockets.has(id)) sockets.set(id, new Set());
    sockets.get(id).add(ws);
    save();
    ensureTick();
    announceChanged();
    return { success: true, sessionId: id, settings: settings(), restorable: restorable(clientInfo).length };
}

function ownSession(clientInfo, id) {
    const session = state.sessions[id];
    if (!session || clientInfo.browsingSession !== id) {
        const error = new Error('not your session');
        error.code = 'NOT_OWNER';
        throw error;
    }
    return session;
}

function update(clientInfo, body) {
    load();
    const session = ownSession(clientInfo, text(body.sessionId, 64));
    session.windows = cleanWindows(body.windows);
    session.lastSeenAt = now();
    session.state = 'live';
    session.idleSince = 0;
    save();
    announceChanged();
    return { success: true };
}

/** Sessions a new client may restore: its own device's earlier ones, and any roaming one (#756 "pass to the next computer"). */
function restorable(clientInfo, opts) {
    load();
    const out = [];
    const all = !!(opts && opts.all);
    for (const session of Object.values(state.sessions)) {
        if (session.id === clientInfo.browsingSession || session.state === 'live' || !tabCount(session)) continue;
        if (session.dismissed && !all) continue;
        if (session.deviceId === clientInfo.browsingDevice || session.roaming) out.push(session);
    }
    return out.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
}

function list(clientInfo) {
    load();
    const cfg = settings();
    const sessionsOut = Object.values(state.sessions)
        .filter((session) => tabCount(session) && visibleTo(clientInfo, session))
        .sort((a, b) => (a.state === 'live' ? 0 : 1) - (b.state === 'live' ? 0 : 1) || (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
        .map((session) => publicSession(session, cfg, session.id === clientInfo.browsingSession));
    return {
        success: true,
        sessionId: clientInfo.browsingSession || '',
        deviceId: clientInfo.browsingDevice || '',
        settings: cfg,
        sessions: sessionsOut,
        restorable: restorable(clientInfo).map((session) => publicSession(session, cfg, false))
    };
}

function ownerFor(clientInfo, body) {
    const session = state.sessions[clientInfo.browsingSession] || {};
    return {
        deviceId: clientInfo.browsingDevice,
        deviceName: session.deviceName || 'Computer',
        deviceKind: session.deviceKind || 'desktop',
        clientSession: clientInfo.browsingSession,
        windowId: text(body && body.windowId, 64),
        tabId: text(body && body.tabId, 64)
    };
}

/** What a client opens for a tab it takes: a live Alchemy page (moved), or an address and history. */
async function openTab(clientInfo, tab, opts) {
    const out = {
        id: tab.id,
        kind: tab.kind,
        url: tab.url,
        title: tab.title,
        icon: tab.icon,
        history: tab.history,
        historyIndex: tab.historyIndex,
        active: tab.active,
        session: null
    };
    if (tab.alchemyId) {
        try {
            out.session = await bridge.transferServiceSession(tab.alchemyId, ownerFor(clientInfo, opts), opts && opts.size);
        } catch (_) {
            out.session = null; // closed meanwhile: the client opens the address
        }
    }
    return out;
}

function closeAlchemy(ids) {
    for (const id of ids) bridge.closeServiceSession(id).catch(() => {});
}

/**
 * Restore Session (#756): the ticked tabs of the chosen sessions come to this client, window by window;
 * everything else in those sessions is discarded (IE's own Restore does the same).
 * body.pick: { [sessionId]: [tabId, ...] }; a session without an entry comes whole.
 */
async function restore(clientInfo, body) {
    load();
    const allowed = new Map(restorable(clientInfo, { all: true }).map((session) => [session.id, session]));
    const ids = (Array.isArray(body.ids) ? body.ids : []).map((id) => text(id, 64)).filter((id) => allowed.has(id));
    const pick = body.pick && typeof body.pick === 'object' ? body.pick : {};
    const windows = [];
    for (const id of ids) {
        const session = allowed.get(id);
        const wanted = Array.isArray(pick[id]) ? new Set(pick[id].map(String)) : null;
        const drop = [];
        for (const win of session.windows) {
            const tabs = [];
            for (const tab of win.tabs) {
                if (wanted && !wanted.has(tab.id)) {
                    if (tab.alchemyId) drop.push(tab.alchemyId);
                    continue;
                }
                tabs.push(await openTab(clientInfo, tab, { windowId: win.id, tabId: tab.id, size: body.size }));
            }
            if (tabs.length) windows.push({ id: win.id, title: win.title, from: session.deviceName, tabs });
        }
        closeAlchemy(drop);
        delete state.sessions[id];
    }
    save();
    announceChanged();
    return { success: true, windows };
}

/** New / Discard (#756): Discard drops the sessions and closes their pages; New keeps them stored but asks no more. */
function discard(clientInfo, body) {
    load();
    const allowed = new Map(restorable(clientInfo, { all: true }).map((session) => [session.id, session]));
    let count = 0;
    for (const raw of Array.isArray(body.ids) ? body.ids : []) {
        const session = allowed.get(text(raw, 64));
        if (!session) continue;
        if (body.keep) {
            // New: the session stays stored (Other Devices still lists it) but Restore Session stops asking
            session.dismissed = true;
            count += 1;
            continue;
        }
        closeAlchemy(alchemyIds(session));
        delete state.sessions[session.id];
        count += 1;
    }
    save();
    announceChanged();
    return { success: true, discarded: count };
}

/**
 * Other Devices (#756): one tab of another session comes here. Alchemy moves (the other device shows
 * "This tab has been transferred to another device"); Grimoire is copied.
 */
async function take(clientInfo, body) {
    load();
    const source = state.sessions[text(body.sessionId, 64)];
    if (!source || !visibleTo(clientInfo, source) || source.id === clientInfo.browsingSession) {
        const error = new Error('no such tab');
        error.code = 'NOT_FOUND';
        throw error;
    }
    let found = null;
    let fromWindow = null;
    for (const win of source.windows) {
        const tab = win.tabs.find((t) => t.id === text(body.tabId, 64));
        if (tab) { found = tab; fromWindow = win; break; }
    }
    if (!found) {
        const error = new Error('no such tab');
        error.code = 'NOT_FOUND';
        throw error;
    }
    const opened = await openTab(clientInfo, found, { windowId: body.windowId, tabId: body.newTabId, size: body.size });
    if (found.kind === 'alchemy') {
        fromWindow.tabs = fromWindow.tabs.filter((t) => t !== found);
        source.windows = source.windows.filter((win) => win.tabs.length);
        const to = (state.sessions[clientInfo.browsingSession] || {}).deviceName || 'another device';
        sendToSession(source.id, { type: 'browsing_session_tab_taken', tabId: found.id, alchemyId: found.alchemyId, to, timestamp: new Date().toISOString() });
        if (!tabCount(source) && source.state !== 'live') delete state.sessions[source.id];
    }
    save();
    announceChanged();
    return { success: true, tab: opened, from: source.deviceName };
}

/** Any session id whose Alchemy page a client wants back after giving it away ("Take it back"). */
function findAlchemyOwner(alchemyId) {
    for (const session of Object.values(state.sessions)) {
        for (const win of session.windows || []) {
            const tab = win.tabs.find((t) => t.alchemyId === alchemyId);
            if (tab) return { session, win, tab };
        }
    }
    return null;
}

async function takeBack(clientInfo, body) {
    const hit = findAlchemyOwner(String(body.alchemyId || ''));
    if (!hit) {
        const error = new Error('the page is no longer open');
        error.code = 'NOT_FOUND';
        throw error;
    }
    return take(clientInfo, { sessionId: hit.session.id, tabId: hit.tab.id, windowId: body.windowId, newTabId: body.newTabId, size: body.size });
}

function onSocketClosed(info, ws) {
    const id = info && info.browsingSession;
    if (!id) return;
    const set = sockets.get(id);
    if (set) {
        set.delete(ws);
        if (set.size) return;
        sockets.delete(id);
    }
    const session = state.sessions[id];
    if (!session || session.state !== 'live') return;
    session.state = 'idle';
    session.idleSince = now();
    session.lastSeenAt = now();
    // "pass the session to the next computer": whoever starts next owns it
    if (settings().roam) session.roaming = true;
    if (!tabCount(session)) delete state.sessions[id];
    save();
    announceChanged();
}

// ---- the clock ----

async function tick() {
    load();
    const cfg = settings();
    const t = now();
    const lease = [];
    let changed = false;
    for (const session of Object.values(state.sessions)) {
        if (session.state === 'live') {
            lease.push(...alchemyIds(session));
            continue;
        }
        if (session.state === 'idle') {
            if (t < (session.idleSince || t) + cfg.idleMinutes * 60000) {
                lease.push(...alchemyIds(session));
                continue;
            }
            // idle time is over: Chromium lets the pages go, the addresses and history stay
            closeAlchemy(alchemyIds(session));
            for (const win of session.windows) for (const tab of win.tabs) tab.alchemyId = '';
            session.state = 'stored';
            changed = true;
            continue;
        }
        if (t > (session.idleSince || session.lastSeenAt || t) + cfg.keepMinutes * 60000 || !tabCount(session)) {
            delete state.sessions[session.id];
            changed = true;
        }
    }
    if (lease.length) {
        try {
            const res = await bridge.leaseServiceSessions([...new Set(lease)], LEASE_TTL_MS);
            // pages the service no longer has (browser restart, crash): the tab keeps its address only
            const missing = new Set(res && Array.isArray(res.missing) ? res.missing : []);
            if (missing.size) {
                for (const session of Object.values(state.sessions)) {
                    for (const win of session.windows || []) {
                        for (const tab of win.tabs) {
                            if (tab.alchemyId && missing.has(tab.alchemyId) && session.state !== 'live') { tab.alchemyId = ''; changed = true; }
                        }
                    }
                }
            }
        } catch (_) { /* the service is down; leases lapse on their own */ }
    }
    if (changed) {
        save();
        announceChanged();
    }
}

function ensureTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => { tick().catch((error) => console.warn('[browsingSessions] tick failed:', error.message)); }, TICK_MS);
    if (tickTimer.unref) tickTimer.unref();
}

function init() {
    load();
    ensureTick();
}

module.exports = {
    init,
    hello,
    update,
    list,
    restore,
    discard,
    take,
    takeBack,
    onSocketClosed,
    tick,
    // tests
    _reset() { state = { sessions: {} }; loaded = true; sockets.clear(); },
    _state() { return state; },
    STATE_FILE
};
