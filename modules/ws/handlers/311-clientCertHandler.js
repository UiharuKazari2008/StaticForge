'use strict';
const wsPacketRegistry = require('../wsPacketRegistry');
const clientCertificates = require('../../clientCertificates');

// Client certificates (Yozora #922; docs/client-certificates.md, docs/client-api/ws/clientCertificates.md):
// Key Manager's Client Certificates store. Signed-in administrators.
//
//   client_cert_list                      -> { success, certificates: [record], crlNumber, validityDays, renewDays }
//   client_cert_revoke { serial, reason } -> { success, certificate: record } | { success:false, code, error }
//     reason: 'revoked' | 'key_compromise' | 'superseded' | 'cessation'
//
// Pushes (modules/clientCertificates.js): client_cert_changed to administrators, client_cert_revoked to the
// revoked client's sockets, client_cert_crl to certificate-opened sessions.

const isAdmin = (info) => !!info && info.authenticated !== false && (info.userType === 'admin' || info.userType === 'dev_admin');

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[311-clientCertHandler] registerPackets: missing handlersCtx');
        return;
    }
    const reply = (ws, message, type, data) => handlersCtx.sendToClient(ws, { type, requestId: message.requestId, data, timestamp: new Date().toISOString() });
    const admin = (ctx) => {
        if (isAdmin(ctx.clientInfo)) return true;
        handlersCtx.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', ctx.message.requestId);
        return false;
    };

    wsPacketRegistry.registerWsPacket('client_cert_list', async (ctx) => {
        if (!admin(ctx)) return;
        let data;
        try {
            const service = clientCertificates.live(handlersCtx.globalResources);
            const s = service.settings();
            data = { success: true, certificates: await service.list(), crlNumber: await service.crlNumber(), validityDays: s.validityDays, renewDays: s.renewDays };
        } catch (e) {
            data = { success: false, error: 'The Key Manager service could not read its certificates.' };
            console.error('client_cert_list:', e.message);
        }
        reply(ctx.ws, ctx.message, 'client_cert_list_response', data);
    }, { owner: 'clientCertificates' });

    wsPacketRegistry.registerWsPacket('client_cert_revoke', async (ctx) => {
        if (!admin(ctx)) return;
        const { ws, message, clientInfo } = ctx;
        let data;
        try {
            const actor = clientInfo.appName || `administrator ${String(clientInfo.clientIP || '').slice(0, 45)}`.trim();
            const result = await clientCertificates.revokeAndTell(handlersCtx.globalResources, String(message.serial || ''), String(message.reason || 'revoked'), actor);
            data = { success: true, certificate: result.record };
        } catch (e) {
            if (e instanceof clientCertificates.ClientCertError) data = { success: false, code: e.code, error: e.message };
            else { data = { success: false, error: 'The certificate could not be revoked.' }; console.error('client_cert_revoke:', e.message); }
        }
        // an administrator revoking the certificate of their own session loses this socket a second later
        reply(ws, message, 'client_cert_revoke_response', data);
    }, { owner: 'clientCertificates', destructive: true });
}

module.exports = { registerPackets };
