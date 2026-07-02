/**
 * Central WebSocket packet handler registry (server).
 * Grimoire domain packets and future domain modules register here.
 *
 * meta.destructive / meta.critical are stored for audit and Phase 1+ routing;
 * isDestructiveOperation() and CRITICAL_MESSAGE_TYPES still own enforcement today.
 */

const registeredPackets = new Map(); // type -> { handler, meta }

function normalizeMeta(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    return {
        destructive: m.destructive === true,
        critical: m.critical === true,
        owner: m.owner != null ? String(m.owner) : ''
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
    if (existing) {
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
        meta: normalizedMeta
    });
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
    listRegisteredPackets
};
