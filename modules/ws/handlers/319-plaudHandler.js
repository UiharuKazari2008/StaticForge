'use strict';

/**
 * Plaud account (CardSpace > Install a Managed Service Account > Plaud; modules/plaudClient.js). Admin only.
 * The account is read only by Yozora's Plaud tools (modules/plaudMcp.js); these packets only sign it in and out.
 *   plaud_account_status            -> { linked, account {name, email}, linkedAt, signingIn, lastError }
 *   plaud_account_link_start        -> { url, redirectUri, expiresAt }  (open url, Authorize)
 *   plaud_account_link_finish {url} -> status  (the http://localhost:8199/... address the browser went to)
 *   plaud_account_link_cancel       -> status
 *   plaud_account_unlink            -> status  (revokes at Plaud, forgets the tokens)
 * Never a token in a reply. docs/client-api/ws/account.md#plaud
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const plaud = require('../../plaudClient');

const ADMIN_DESTRUCTIVE = { destructive: true };

function guard(type, fn) {
    return async (handlersCtx, ws, message, clientInfo) => {
        if (!(clientInfo && clientInfo.userType === 'admin')) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            const data = await fn(message || {});
            handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data: Object.assign({ success: true }, data), timestamp: new Date().toISOString() });
        } catch (error) {
            handlersCtx.sendError(ws, error.message, error.code || 'PLAUD_FAILED', message.requestId);
        }
    };
}

function registerPackets() {
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await guard(type, fn)(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo);
        }, { owner: 'plaud', ...meta });
    };
    reg('plaud_account_status', () => plaud.status());
    reg('plaud_account_link_start', () => plaud.linkStart(), ADMIN_DESTRUCTIVE);
    reg('plaud_account_link_finish', (m) => plaud.linkFinish(m.url || m.code), ADMIN_DESTRUCTIVE);
    reg('plaud_account_link_cancel', () => { plaud.linkCancel(); return plaud.status(); }, ADMIN_DESTRUCTIVE);
    reg('plaud_account_unlink', () => plaud.unlink(), ADMIN_DESTRUCTIVE);
}

module.exports = { registerPackets };
