// Central inbound WebSocket handler registry — complements wsClient.on/off/triggerEvent.
// Loaded before public/scripts/websocket.js.
// Phases (wired in websocket.js handleMessage): pre → only (skip built-in) → triggerEvent/switch → post.

// The dev-mode flag (localStorage staticforge_dev_mode), read once and again when it changes: another tab's write
// (the storage event below) or this tab's toggle (serverManagement.toggleRuntimeDevMode calls
// isWsInboundDevLogEnabled(true)). Every message with no handler read localStorage here.
const wsInboundDevLogFlag = { key: 'staticforge_dev_mode', on: null };

const wsInboundHandlers = [];
const wsInboundHandlersById = new Map();
// 'phase|type' -> the handlers for it (aliases included), highest priority first and in registration order among
// equals (as the filter + sort per message did). Replaced, never changed in place, so a handler that registers or
// unregisters during a dispatch does not change the list being walked.
const wsInboundHandlersByKey = new Map();

function isWsInboundDevLogEnabled(refresh) {
    if (refresh || wsInboundDevLogFlag.on === null) {
        try {
            wsInboundDevLogFlag.on = localStorage.getItem(wsInboundDevLogFlag.key) === 'true';
        } catch (_e) {
            wsInboundDevLogFlag.on = false;
        }
    }
    return wsInboundDevLogFlag.on;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    // app-scope: allow page-lifetime shell registry (loaded once by app.html before websocket.js, never unloaded)
    window.addEventListener('storage', (e) => {
        if (e.key === null || e.key === wsInboundDevLogFlag.key) isWsInboundDevLogEnabled(true);
    });
}

function wsInboundDevLog(message, detail) {
    if (!isWsInboundDevLogEnabled()) return;
    if (detail !== undefined) {
        console.debug('[wsInboundRegistry]', message, detail);
    } else {
        console.debug('[wsInboundRegistry]', message);
    }
}

function normalizePhase(phase) {
    const p = phase || 'post';
    if (p === 'pre' || p === 'post' || p === 'only') return p;
    console.warn('[wsInboundRegistry] invalid phase, defaulting to post:', phase);
    return 'post';
}

/**
 * @param {{ id: string, type: string, alias?: string|string[], phase?: 'pre'|'post'|'only', priority?: number, handler: Function }} options
 * @returns {() => void} unregister
 */
function registerWsInboundHandler(options) {
    if (!options || !options.id) {
        console.warn('[wsInboundRegistry] registerWsInboundHandler requires id');
        return function noopUnregister() {};
    }
    if (!options.type || typeof options.handler !== 'function') {
        console.warn('[wsInboundRegistry] registerWsInboundHandler requires type and handler for', options.id);
        return function noopUnregister() {};
    }

    const id = String(options.id);
    const phase = normalizePhase(options.phase);

    if (wsInboundHandlersById.has(id)) {
        console.warn('[wsInboundRegistry] duplicate registration id:', id);
    }

    const duplicateTypePhase = wsInboundHandlers.find((entry) => entry.phase === phase && entry.type === options.type);
    if (duplicateTypePhase && duplicateTypePhase.id !== id) {
        console.warn(
            '[wsInboundRegistry] duplicate type+phase registration:',
            options.type,
            phase,
            'ids:',
            duplicateTypePhase.id,
            id
        );
    }

    const entry = {
        id,
        type: String(options.type),
        alias: options.alias || null,
        phase,
        priority: Number.isFinite(options.priority) ? options.priority : 0,
        handler: options.handler
    };

    wsInboundHandlers.push(entry);
    wsInboundHandlersById.set(id, entry);
    // the 'phase|type' keys this entry answers: its type and its aliases, each once
    const types = new Set([entry.type]);
    if (Array.isArray(entry.alias)) entry.alias.forEach((a) => types.add(a));
    else if (entry.alias) types.add(entry.alias);
    const keys = Array.from(types, (t) => `${phase}|${t}`);
    for (const key of keys) {
        const list = (wsInboundHandlersByKey.get(key) || []).concat(entry);
        // stable: equal priorities stay in registration order
        list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        wsInboundHandlersByKey.set(key, list);
    }

    wsInboundDevLog('registered', { id, type: entry.type, phase: entry.phase, priority: entry.priority });

    return function unregisterWsInboundHandler() {
        const idx = wsInboundHandlers.indexOf(entry);
        if (idx > -1) {
            wsInboundHandlers.splice(idx, 1);
        }
        if (wsInboundHandlersById.get(id) === entry) {
            wsInboundHandlersById.delete(id);
        }
        for (const key of keys) {
            const list = wsInboundHandlersByKey.get(key);
            if (!list || !list.includes(entry)) continue;
            const rest = list.filter((e) => e !== entry);
            if (rest.length) wsInboundHandlersByKey.set(key, rest);
            else wsInboundHandlersByKey.delete(key);
        }
        wsInboundDevLog('unregistered', { id });
    };
}

function dispatchWsInbound(message, wsClient, phase) {
    if (!message || !message.type) return false;

    const dispatchPhase = normalizePhase(phase);
    const messageType = message.type;
    // kept sorted by registerWsInboundHandler (it filtered ~73 handlers and sorted per phase per message)
    const matching = wsInboundHandlersByKey.get(`${dispatchPhase}|${messageType}`);

    if (!matching) {
        wsInboundDevLog('no handlers', { type: messageType, phase: dispatchPhase });
        return false;
    }

    for (const entry of matching) {
        try {
            entry.handler(message, wsClient);
        } catch (error) {
            console.error('[wsInboundRegistry] handler error for', entry.id, error);
            // report: public/scripts/comp/programFaults.js (the program the handler belongs to stops working)
            if (typeof window !== 'undefined' && window.programFaults) window.programFaults.report(error, { source: 'ws:' + entry.id });
        }
    }

    return true;
}

function listRegisteredWsInboundHandlers() {
    return wsInboundHandlers.map((entry) => ({
        id: entry.id,
        type: entry.type,
        alias: entry.alias,
        phase: entry.phase,
        priority: entry.priority
    }));
}
