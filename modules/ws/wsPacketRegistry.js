/**
 * Central WebSocket packet handler registry (server).
 * Grimoire domain packets and future domain modules register here.
 *
 * meta.destructive / meta.critical are stored for audit and Phase 1+ routing;
 * isDestructiveOperation() and CRITICAL_MESSAGE_TYPES still own enforcement today.
 */

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
        fifoScope: m.fifoScope === 'global' ? 'global' : 'connection'
    };
}

/**
 * @param {string} type
 * @param {(ctx: { ws, message, clientInfo, wsServer, handlers }) => Promise<void>|void} handler
 * @param {{ destructive?: boolean, critical?: boolean, owner?: string }} [meta]
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

module.exports = {
    registerWsPacket,
    getWsPacketHandler,
    getWsPacketEntry,
    listRegisteredPackets,
    withRegistrar,
    unregisterByFile,
    typesOfFile
};
