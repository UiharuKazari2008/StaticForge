/**
 * Resolves an MCP caller's request into a Dovecote mailbox owner. Never
 * reads anything client-supplied — only req.applicationAuth (set by
 * modules/auth.js from the application key) and, for the shared "Xi" key
 * that Cursor- and Claude-runtime jobs both use, the currently active Xi
 * session's runtime (modules/xiDirector.js, #395's runtime picker).
 */

'use strict';

const { resolveActorName } = require('./agentClientBridge');
const { resolveOwnerFromActor } = require('./dovecoteMail');

function resolveDovecoteOwnerFromReq(req) {
    const actor = resolveActorName(req);
    if (!actor) return null;
    if (actor.trim().toLowerCase() === 'xi') {
        const xiDirector = require('./xiDirector');
        return xiDirector.activeRuntime() || 'cursor';
    }
    return resolveOwnerFromActor(actor);
}

module.exports = { resolveDovecoteOwnerFromReq };
