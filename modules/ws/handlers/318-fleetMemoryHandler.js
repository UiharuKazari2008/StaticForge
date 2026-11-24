'use strict';

/**
 * Fleet's shared memory (#1154): the review queue and the memory list for the Fleet UI. Admin only, as 313.
 * Store, approval by the Supervisor's model, markdown mirror: modules/agentCoord/memoryStore.js. This handler
 * also starts the store's server side (memory.sock for the MCP processes, the review pass, the mirror watch).
 * Push: statusHub feed `fleet_memory` (status_subscribe { feed: 'fleet_memory' }) -> `claude_fleet_memory_status`.
 * docs/client-api/ws/account.md#fleet-shared-memory
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const statusHub = require('../statusHub');
const mem = require('../../agentCoord/memoryStore');

const isAdmin = (clientInfo) => !!(clientInfo && clientInfo.userType === 'admin');

let feed = null;
let armed = false;

function defineFeed() {
    if (feed) return;
    feed = statusHub.define({
        name: 'fleet_memory',
        pushType: 'claude_fleet_memory_status',
        intervalMs: 300000,
        allow: isAdmin,
        sample: async () => { const s = mem.stats(); return { counts: { proposed: s.proposed, active: s.active, flagged: s.flagged, stale: s.stale }, changed: s.lastChange }; }
    });
}

async function act(gr, message) {
    const action = String((message && message.action) || 'list');
    const id = Number(message && message.id);
    const by = 'Fleet';
    switch (action) {
    case 'list': return mem.list({ scope: message.scope, status: message.status, q: message.q, before: message.before, limit: message.limit });
    case 'get': { const m = mem.get(id); if (!m) throw new Error('No such memory'); return { memory: m }; }
    case 'digest': return { digest: mem.digest({ repo: message.repo }) };
    case 'stats': return { stats: mem.stats() };
    case 'approve': return { memory: mem.approve(id, message.note || 'approved in Fleet', by) };
    case 'reject': return { memory: mem.reject(id, message.note || 'rejected in Fleet', by) };
    case 'update': return { memory: mem.edit(id, { body: message.body, title: message.title, kind: message.kind, tags: message.tags, scope: message.scope }, by) };
    case 'pin': return { memory: mem.pin(id, message.pinned === true) };
    case 'unflag': return { memory: mem.clearFlag(id) };
    case 'review': return { decided: await mem.reviewPending(gr, { force: true }) };
    case 'remove': return mem.remove(id);
    default: throw new Error('action must be list, get, approve, reject, update, pin, unflag, review, remove, digest or stats');
    }
}

async function handle(handlersCtx, ws, message, clientInfo) {
    if (!isAdmin(clientInfo)) {
        handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message && message.requestId);
        return;
    }
    try {
        const action = String((message && message.action) || 'list');
        const data = await act(handlersCtx.globalResources, message || {});
        if (!['list', 'get', 'digest', 'stats'].includes(action)) mem.afterChange(Number(message.id) || null, { review: false }).catch(() => {});
        handlersCtx.sendToClient(ws, { type: 'claude_fleet_memory_response', requestId: message.requestId, data: Object.assign({ success: true, action }, data), timestamp: new Date().toISOString() });
    } catch (error) {
        console.warn(`[fleetMemory] ${error.message}`);
        handlersCtx.sendError(ws, error.message, 'FLEET_MEMORY_FAILED', message && message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    defineFeed();
    mem.onChange(() => { if (feed) feed.poke(); });
    if (!armed && process.env.DREAMSCAPE_CLAUDE_RC_READONLY !== '1') {
        armed = true;
        setTimeout(() => { try { mem.serve(handlersCtx.globalResources); } catch (e) { console.warn(`[fleetMemory] ${e.message}`); } }, 6000).unref();
    }
    wsPacketRegistry.registerWsPacket('claude_fleet_memory', async (ctx) => {
        await handle(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
    }, { owner: 'fleetMemory' });
}

module.exports = { registerPackets, _handle: handle, _act: act };
