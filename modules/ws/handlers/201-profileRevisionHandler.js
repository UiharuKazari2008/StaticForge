'use strict';

/**
 * profile_revision (#910): the server's revision of the user's profile (modules/profileRevision.js). A client takes it
 * with each cached profile (public/scripts/comp/profileCache.js) and compares it when it reconnects after a logon
 * from its cache. Moves on with every profile write (routeMessage), pushed as profile_changed.
 *
 *   -> { type: 'profile_revision', requestId }
 *   <- { type: 'profile_revision_response', requestId, data: { revision } }
 */
const wsPacketRegistry = require('../wsPacketRegistry');
const profileRevision = require('../../profileRevision');

async function handleProfileRevision(handlers, ws, message) {
    handlers.sendToClient(ws, {
        type: 'profile_revision_response',
        requestId: message.requestId,
        data: { revision: profileRevision.current() },
        timestamp: new Date().toISOString()
    });
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[201-profileRevisionHandler] registerPackets: missing handlersCtx');
        return;
    }
    wsPacketRegistry.registerWsPacket('profile_revision', async (ctx) => {
        await handleProfileRevision(ctx.handlers, ctx.ws, ctx.message);
    }, { owner: 'profileRevision' });
}

module.exports = { registerPackets, handleProfileRevision };
