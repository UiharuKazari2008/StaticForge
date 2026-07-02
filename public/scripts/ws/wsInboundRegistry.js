// Central inbound WebSocket handler registry — complements wsClient.on/off/triggerEvent.
// Loaded before public/scripts/websocket.js.
// Phases (wired in websocket.js handleMessage): pre → only (skip built-in) → triggerEvent/switch → post.

const WS_INBOUND_DEV_FLAG = 'staticforge_dev_mode';

const wsInboundHandlers = [];
const wsInboundHandlersById = new Map();

function isWsInboundDevLogEnabled() {
    try {
        return localStorage.getItem(WS_INBOUND_DEV_FLAG) === 'true';
    } catch (_e) {
        return false;
    }
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

function handlerMatchesType(entry, messageType) {
    if (entry.type === messageType) return true;
    if (!entry.alias) return false;
    if (Array.isArray(entry.alias)) {
        return entry.alias.includes(messageType);
    }
    return entry.alias === messageType;
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

    wsInboundDevLog('registered', { id, type: entry.type, phase: entry.phase, priority: entry.priority });

    return function unregisterWsInboundHandler() {
        const idx = wsInboundHandlers.indexOf(entry);
        if (idx > -1) {
            wsInboundHandlers.splice(idx, 1);
        }
        if (wsInboundHandlersById.get(id) === entry) {
            wsInboundHandlersById.delete(id);
        }
        wsInboundDevLog('unregistered', { id });
    };
}

function dispatchWsInbound(message, wsClient, phase) {
    if (!message || !message.type) return false;

    const dispatchPhase = normalizePhase(phase);
    const messageType = message.type;
    const matching = wsInboundHandlers.filter((entry) => entry.phase === dispatchPhase && handlerMatchesType(entry, messageType));

    if (matching.length === 0) {
        wsInboundDevLog('no handlers', { type: messageType, phase: dispatchPhase });
        return false;
    }

    matching.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const entry of matching) {
        try {
            entry.handler(message, wsClient);
        } catch (error) {
            console.error('[wsInboundRegistry] handler error for', entry.id, error);
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
