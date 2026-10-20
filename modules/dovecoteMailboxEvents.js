/**
 * Dovecote mailbox_new_mail event bus.
 *
 * Inbox delivery publishes a per-mailbox event onto the in-process bus
 * (and data plumbing when it is up). WebSocket clients that subscribed
 * receive type mailbox_new_mail. App-key sockets may subscribe to their
 * own mailbox only. The notify-forward dispatcher consumes this stream
 * instead of hooking sendMail / deliverInboundMail.
 *
 * Flood control for sockets: per-socket events-per-minute with drop+count.
 * Notice coalescing and the global notice cap live in dovecoteMailboxNotify.js.
 */

'use strict';

const EVENT_TYPE = 'mailbox_new_mail';
const RATE_LIMITED_TYPE = 'mailbox_new_mail_rate_limited';
const PLUMBING_TOPIC = 'dovecote:mailbox_new_mail';
const DEFAULT_SOCKET_PER_MINUTE = 60;

let testOverrides = null;
let wsServerGetter = null;
const subscribers = new Set();
const socketStates = new Map();

function setTestOverrides(overrides) {
    testOverrides = overrides || null;
}

function resetForTests() {
    testOverrides = null;
    wsServerGetter = null;
    subscribers.clear();
    socketStates.clear();
}

function nowMs() {
    if (testOverrides && typeof testOverrides.now === 'function') return testOverrides.now();
    return Date.now();
}

function nowIso() {
    return new Date().toISOString();
}

function socketPerMinute() {
    if (testOverrides && testOverrides.socketPerMinute != null) {
        const value = Number(testOverrides.socketPerMinute);
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_SOCKET_PER_MINUTE;
    }
    try {
        const gr = require('./globalResources');
        const cfg = (gr.getConfig && gr.getConfig()) || {};
        const value = Number(cfg.dovecote && cfg.dovecote.notify && cfg.dovecote.notify.socketPerMinute);
        if (Number.isFinite(value) && value > 0) return Math.min(600, Math.floor(value));
    } catch (_err) { /* config optional */ }
    return DEFAULT_SOCKET_PER_MINUTE;
}

function bindWebSocketServer(getter) {
    wsServerGetter = typeof getter === 'function' ? getter : () => getter;
}

function getWsServer() {
    if (testOverrides && testOverrides.wsServer) return testOverrides.wsServer;
    if (!wsServerGetter) return null;
    try {
        return wsServerGetter();
    } catch (_err) {
        return null;
    }
}

function getPlumbing() {
    if (testOverrides && Object.prototype.hasOwnProperty.call(testOverrides, 'plumbing')) {
        return testOverrides.plumbing;
    }
    try {
        const gr = require('./globalResources');
        if (gr && typeof gr.getDataPlumbing === 'function') return gr.getDataPlumbing();
    } catch (_err) { /* optional */ }
    return null;
}

function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

function isAppKeyClient(clientInfo) {
    if (!clientInfo) return false;
    if (clientInfo.authMethod === 'application_key') return true;
    if (clientInfo.applicationKeyId || clientInfo.applicationAuth) return true;
    const sid = String(clientInfo.sessionId || '');
    return sid.startsWith('appkey:');
}

function resolveOwnerFromClientInfo(clientInfo) {
    if (!clientInfo) return null;
    try {
        const { resolveDovecoteOwnerFromReq } = require('./dovecoteIdentity');
        const owner = resolveDovecoteOwnerFromReq({
            applicationAuth: clientInfo.applicationAuth || {
                appName: clientInfo.appName,
                applicationScopes: clientInfo.applicationScopes,
                applicationKeyId: clientInfo.applicationKeyId
            }
        });
        if (owner) return owner;
    } catch (_err) { /* fall through */ }
    try {
        const { resolveOwnerFromActor } = require('./dovecoteMail');
        const name = clientInfo.appName
            || (clientInfo.applicationAuth && clientInfo.applicationAuth.appName);
        if (name) return resolveOwnerFromActor(name);
    } catch (_err) { /* fall through */ }
    return null;
}

function resolveSubscribeMailbox(clientInfo, requested) {
    const { DovecoteError, isValidOwner, HUMAN_OWNER } = require('./dovecoteMail');
    const want = requested ? String(requested).trim().toLowerCase() : '';
    if (isAppKeyClient(clientInfo)) {
        const owner = resolveOwnerFromClientInfo(clientInfo);
        if (!owner) {
            throw new DovecoteError('Caller identity does not map to a Dovecote mailbox', 'FORBIDDEN');
        }
        if (want && want !== owner) {
            throw new DovecoteError('App-key sockets may subscribe to their own mailbox only', 'FORBIDDEN');
        }
        return owner;
    }
    if (!clientInfo || clientInfo.authenticated !== true) {
        throw new DovecoteError('Authentication required', 'FORBIDDEN');
    }
    const mailbox = want || HUMAN_OWNER;
    if (!isValidOwner(mailbox)) {
        throw new DovecoteError('Unknown mailbox', 'UNKNOWN_OWNER');
    }
    return mailbox;
}

function subscribeSocket(ws, clientInfo, mailbox) {
    let state = socketStates.get(ws);
    if (!state) {
        state = { mailboxes: new Set(), hits: [], dropped: 0, clientInfo };
        socketStates.set(ws, state);
        if (ws && typeof ws.on === 'function') {
            ws.on('close', () => socketStates.delete(ws));
        }
    }
    state.mailboxes.add(mailbox);
    state.clientInfo = clientInfo || state.clientInfo;
    return { mailbox, subscribed: true };
}

function unsubscribeSocket(ws, mailbox) {
    const state = socketStates.get(ws);
    if (!state) return { mailbox: mailbox || null, subscribed: false };
    if (mailbox) state.mailboxes.delete(mailbox);
    else state.mailboxes.clear();
    if (!state.mailboxes.size) socketStates.delete(ws);
    return { mailbox: mailbox || null, subscribed: false };
}

function noteSocketEvent(state) {
    const now = nowMs();
    const cap = socketPerMinute();
    state.hits = (state.hits || []).filter((ts) => now - ts < 60000);
    if (state.hits.length >= cap) {
        state.dropped = (state.dropped || 0) + 1;
        return { send: false, dropped: state.dropped, justLimited: state.dropped === 1 };
    }
    state.hits.push(now);
    const dropped = state.dropped || 0;
    state.dropped = 0;
    return { send: true, dropped };
}

function sendToSocket(ws, message) {
    if (testOverrides && typeof testOverrides.sendToClient === 'function') {
        testOverrides.sendToClient(ws, message);
        return;
    }
    const wsServer = getWsServer();
    if (wsServer && typeof wsServer.sendToClient === 'function') {
        wsServer.sendToClient(ws, message);
        return;
    }
    if (ws && typeof ws.send === 'function') {
        ws.send(JSON.stringify(message));
    }
}

function fanoutSockets(event) {
    const mailbox = event.mailbox;
    for (const [ws, state] of socketStates) {
        if (!state.mailboxes.has(mailbox)) continue;
        if (ws && ws.readyState != null && ws.readyState !== 1) continue;
        const decision = noteSocketEvent(state);
        const timestamp = nowIso();
        if (!decision.send) {
            if (decision.justLimited) {
                sendToSocket(ws, {
                    type: RATE_LIMITED_TYPE,
                    data: { mailbox, dropped: decision.dropped },
                    timestamp
                });
            }
            continue;
        }
        sendToSocket(ws, {
            type: EVENT_TYPE,
            data: {
                mailbox: event.mailbox,
                id: event.id,
                from: event.from,
                subject: event.subject,
                receivedAt: event.receivedAt,
                dropped: decision.dropped
            },
            timestamp
        });
    }
}

function publishPlumbing(event) {
    try {
        const plumbing = getPlumbing();
        if (!plumbing || typeof plumbing.publish !== 'function') return;
        plumbing.publish(PLUMBING_TOPIC, event);
        plumbing.publish(`${PLUMBING_TOPIC}:${event.mailbox}`, event);
    } catch (err) {
        console.error('Dovecote mailbox_new_mail plumbing publish failed:', err.message);
    }
}

function ensureNotifyDispatcher() {
    try {
        require('./dovecoteMailboxNotify').bindEventStream();
    } catch (_err) { /* dispatcher optional in isolated tests */ }
}

function toEvent(delivery) {
    return {
        mailbox: delivery.mailbox,
        id: delivery.id,
        from: delivery.from || '',
        subject: delivery.subject || '',
        receivedAt: delivery.receivedAt || nowIso(),
        notifyLoop: delivery.notifyLoop === true,
        folder: delivery.folder || 'inbox',
        spam: delivery.spam === true,
        headers: delivery.headers || null
    };
}

function emitNewMail(deliveries) {
    if (!Array.isArray(deliveries) || !deliveries.length) return;
    ensureNotifyDispatcher();
    deliveries.forEach((delivery) => {
        if (!delivery || !delivery.mailbox || !delivery.id) return;
        const event = toEvent(delivery);
        subscribers.forEach((callback) => {
            try {
                callback(event);
            } catch (err) {
                console.error('Dovecote mailbox_new_mail subscriber failed:', err.message);
            }
        });
        publishPlumbing(event);
        fanoutSockets(event);
    });
}

function getSocketState(ws) {
    return socketStates.get(ws) || null;
}

module.exports = {
    EVENT_TYPE,
    RATE_LIMITED_TYPE,
    PLUMBING_TOPIC,
    DEFAULT_SOCKET_PER_MINUTE,
    setTestOverrides,
    resetForTests,
    subscribe,
    emitNewMail,
    bindWebSocketServer,
    resolveSubscribeMailbox,
    resolveOwnerFromClientInfo,
    isAppKeyClient,
    subscribeSocket,
    unsubscribeSocket,
    getSocketState
};
