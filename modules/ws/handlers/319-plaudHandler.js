'use strict';

/**
 * Plaud account (CardSpace > Install a Managed Service Account > Plaud; modules/plaudClient.js). Admin only.
 * The account is read only by Yozora's Plaud tools (modules/plaudMcp.js); these packets only sign it in and out.
 *   plaud_account_status            -> { linked, account {name, email}, linkedAt, signingIn, lastError, device }
 *     device = { state ('ok' | 'missing' | 'unknown'), signedIn, recorders[{ name, model, serial ("...1884"), firmware, battery, lastSync }], readAt, lastError, url }
 *     (the recorder, read from Plaud's web page in the server's Alchemy browser where she is signed in: modules/plaudDevice.js;
 *      missing = that browser is not signed in to Plaud: open url there; battery / lastSync are null, Plaud's cloud has none)
 *   plaud_device_read               -> full status (reads the recorder again now)
 *   plaud_account_link_start        -> { url, redirectUri, expiresAt }  (open url, Authorize)
 *   plaud_account_link_finish {url} -> status  (the http://localhost:8199/... address the browser went to)
 *   plaud_account_link_cancel       -> status
 *   plaud_account_unlink            -> status  (revokes at Plaud, forgets the tokens)
 * Push plaud_account_changed (full status incl. device) when the server finished a sign-in on its :8199 callback or the recorder read changed (known, not signed in). Never a token in a reply. docs/client-api/ws/account.md#plaud
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const plaud = require('../../plaudClient');
const plaudDevice = require('../../plaudDevice');

const ADMIN_DESTRUCTIVE = { destructive: true };

/** The developer account's status plus the Plaud app account's (device). */
async function fullStatus() {
    return Object.assign({}, await plaud.status(), { device: plaudDevice.status() });
}

const withDevice = async (p) => Object.assign({}, await p, { device: plaudDevice.status() });

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

function registerPackets(handlersCtx) {
    // a sign-in the server finished itself (the :8199 callback) reaches CardSpace as plaud_account_changed, admins only
    plaudDevice.attach(handlersCtx && handlersCtx.globalResources);
    const push = async (status) => {
        const gr = handlersCtx && handlersCtx.globalResources;
        const srv = gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
        const admin = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));
        if (srv && typeof srv.broadcast === 'function') srv.broadcast({ type: plaud.STATUS_TYPE, data: Object.assign({}, status, { device: plaudDevice.status() }), timestamp: new Date().toISOString() }, admin);
    };
    plaud.bind(push);
    plaudDevice.bind(async () => push(await plaud.status()));
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await guard(type, fn)(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo);
        }, { owner: 'plaud', ...meta });
    };
    reg('plaud_account_status', () => fullStatus());
    reg('plaud_account_link_start', () => plaud.linkStart(), ADMIN_DESTRUCTIVE);
    reg('plaud_account_link_finish', (m) => withDevice(plaud.linkFinish(m.url || m.code)), ADMIN_DESTRUCTIVE);
    reg('plaud_account_link_cancel', () => { plaud.linkCancel(); return fullStatus(); }, ADMIN_DESTRUCTIVE);
    reg('plaud_account_unlink', () => withDevice(plaud.unlink()), ADMIN_DESTRUCTIVE);
    reg('plaud_device_read', async () => { await plaudDevice.refresh(); return fullStatus(); });
}

module.exports = { registerPackets };
