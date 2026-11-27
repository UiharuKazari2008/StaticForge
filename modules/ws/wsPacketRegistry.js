/**
 * Central WebSocket packet handler registry (server).
 * Grimoire domain packets and future domain modules register here.
 *
 * meta.destructive / meta.critical are stored for audit and Phase 1+ routing;
 * isDestructiveOperation() and CRITICAL_MESSAGE_TYPES still own enforcement today.
 */

// The names a person reads for request types, and the types that never show in the WebSocket ticker (#1350).
// Plain data, read at registration time only; scripts/check-ws-names.js keeps it and the client's copy from drifting.
const requestNames = require('./wsRequestNames');
const QUIET_TYPES = new Set(requestNames.quiet);

const registeredPackets = new Map(); // type -> { handler, meta, file }

// Which handler file is registering right now (set by withRegistrar), so a hot reload can drop and redo one file's types (#1293).
let currentRegistrar = '';

function normalizeMeta(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    return {
        destructive: m.destructive === true,
        critical: m.critical === true,
        owner: m.owner != null ? String(m.owner) : '',
        dispatch: m.dispatch === 'fifo' ? 'fifo' : 'parallel',
        fifoScope: m.fifoScope === 'global' ? 'global' : 'connection',
        // words a person reads for this request (the ticker shows it); '' = look in modules/ws/wsRequestNames.js
        name: typeof m.name === 'string' ? m.name.trim() : '',
        // true / false = decided; null = undecided (resolved by registerWsPacket)
        ticker: typeof m.ticker === 'boolean' ? m.ticker : null
    };
}

/** An answer or a push (not a request): never needs a name or a ticker decision. */
function isAnswerType(type) {
    return /_(response|error|update|progress)$/.test(String(type || ''));
}

/**
 * @param {string} type
 * @param {(ctx: { ws, message, clientInfo, wsServer, handlers }) => Promise<void>|void} handler
 * @param {{ destructive?: boolean, critical?: boolean, owner?: string, name?: string, ticker?: boolean }} [meta]
 *   name: words a person reads for a request type; ticker: false = machinery, never shown in the ticker.
 *   A request type needs one of them (or an entry in modules/ws/wsRequestNames.js): "if a name cannot be written,
 *   it is machinery, and if it is machinery it does not go in the ticker" (#1350).
 */
function registerWsPacket(type, handler, meta = {}) {
    const packetType = String(type || '').trim();
    if (!packetType || typeof handler !== 'function') {
        console.warn('[wsPacketRegistry] registerWsPacket: bad args', type);
        return;
    }

    const normalizedMeta = normalizeMeta(meta);
    const existing = registeredPackets.get(packetType);
    if (existing && !(currentRegistrar && existing.file === currentRegistrar)) {
        console.warn(
            '[wsPacketRegistry] duplicate registration for type',
            packetType,
            'owner:',
            normalizedMeta.owner || '(unknown)',
            'previous owner:',
            existing.meta.owner || '(unknown)'
        );
    }

    // name: meta, else the table; ticker: meta boolean, else false for a quiet type, else true when a name resolved
    if (!normalizedMeta.name && Object.prototype.hasOwnProperty.call(requestNames.names, packetType)) {
        normalizedMeta.name = String(requestNames.names[packetType]);
    }
    if (normalizedMeta.ticker === null) {
        if (QUIET_TYPES.has(packetType)) normalizedMeta.ticker = false;
        else if (normalizedMeta.name) normalizedMeta.ticker = true;
    }
    if (normalizedMeta.ticker === null && !isAnswerType(packetType)) {
        console.warn(
            '[wsPacketRegistry] undecided name/ticker for type',
            packetType,
            'registered by:',
            currentRegistrar || '(unknown file)',
            '- set meta.name (words a person reads) or meta.ticker:false (machinery), or add it to modules/ws/wsRequestNames.js'
        );
    }

    registeredPackets.set(packetType, {
        handler,
        meta: normalizedMeta,
        file: currentRegistrar
    });
}

/** Runs fn synchronously; every registerWsPacket during it records `file` as the registrar. */
function withRegistrar(file, fn) {
    const prev = currentRegistrar;
    currentRegistrar = String(file || '');
    try {
        return fn();
    } finally {
        currentRegistrar = prev;
    }
}

/** Removes every type registered by `file`; returns those types. */
function unregisterByFile(file) {
    const f = String(file || '');
    const removed = [];
    if (!f) return removed;
    for (const [type, entry] of Array.from(registeredPackets.entries())) {
        if (entry.file === f) {
            registeredPackets.delete(type);
            removed.push(type);
        }
    }
    return removed;
}

/** The types `file` registered. */
function typesOfFile(file) {
    const f = String(file || '');
    if (!f) return [];
    const out = [];
    for (const [type, entry] of registeredPackets) if (entry.file === f) out.push(type);
    return out;
}

function getWsPacketHandler(type) {
    const entry = registeredPackets.get(String(type || ''));
    return entry ? entry.handler : null;
}

function getWsPacketEntry(type) {
    return registeredPackets.get(String(type || '')) || null;
}

function listRegisteredPackets() {
    return Array.from(registeredPackets.entries()).map(([type, entry]) => ({
        type,
        meta: { ...entry.meta }
    }));
}

/** Request types registered with no name and no ticker decision: [{ type, file }]. */
function listUndecidedPackets() {
    const out = [];
    for (const [type, entry] of registeredPackets) {
        if (entry.meta.ticker === null && !isAnswerType(type)) out.push({ type, file: entry.file });
    }
    return out;
}

module.exports = {
    isAnswerType,
    listUndecidedPackets,
    registerWsPacket,
    getWsPacketHandler,
    getWsPacketEntry,
    listRegisteredPackets,
    withRegistrar,
    unregisterByFile,
    typesOfFile
};
