'use strict';

/**
 * Today's Recordings item (#1144; modules/plaudToday.js). Admin only; the page never reads Plaud itself.
 *   plaud_today_list                 -> { linked, recordings[{ id, name, createdAt, startAt, durationMs, source, review }], battery, device, lastRead, stale, waiting, reviewing, lastSync, deviceLogin }
 *     (device { name, model } | null, battery 0-100 | null, lastSync ms | null: the recorder, from Plaud's web page in the server's browser (plaudDevice.js); battery and lastSync stay null, Plaud's cloud has neither;
 *      deviceLogin 'ok' | 'missing' (that browser is not signed in to Plaud) | 'unknown'; stale: true = Plaud was unreachable, the kept list with its older lastRead)
 *     (transfer { state: 'transferring' | 'complete' | 'none', at, noteReadyAt }: the recorder's transfer status from the Plaud phone app's notifications, plaudTransfer.js)
 *   plaud_today_changed (server push, admin / dev_admin sockets) { transfer }: the transfer status changed
 *   plaud_today_summary { id }       -> { id, name, title, summary, review }
 *   plaud_today_review { id }        -> { sessionId, started, deduped, review }   (one agent session; a second press only returns it)
 *   plaud_today_review_new           -> { sessionId, started, deduped, count, review } | { started: false, none: true, count: 0, waiting: 0 }   (one chat for every unreviewed recording)
 * review = null | { sessionId, status: 'running' | 'idle', issues[], updatedAt }. docs/client-api/ws/account.md#plaud
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const today = require('../../plaudToday');
const plaudTransfer = require('../../plaudTransfer');

function registerPackets(handlersCtx) {
    // the Plaud phone app's transfer notices (#1193): a change of the status is pushed to admins, never polled
    plaudTransfer.attach();
    const pushChanged = () => {
        const gr = handlersCtx && handlersCtx.globalResources;
        const srv = gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
        const admin = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));
        if (srv && typeof srv.broadcast === 'function') srv.broadcast({ type: 'plaud_today_changed', data: { transfer: plaudTransfer.state() }, timestamp: new Date().toISOString() }, admin);
    };
    // a transfer notice means the recorder is awake beside the phone: the moment to read its battery again (no timer does)
    plaudTransfer.bind(() => {
        pushChanged();
        try { require('../../plaudDevice').battery(handlersCtx && handlersCtx.globalResources); } catch (_) { /* no recorder module */ }
    });
    // the recorder's battery word arrived from the phone (plaudDevice.battery): the page reads the list again
    try { require('../../plaudDevice').onBattery(pushChanged); } catch (_) { /* no recorder module */ }
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo } = ctx;
            const h = ctx.handlers || handlersCtx;
            if (!(clientInfo && /^(admin|dev_admin)$/.test(String(clientInfo.userType || '')))) {
                h.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }
            try {
                const data = await fn(message || {}, h);
                h.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data: Object.assign({ success: true }, data), timestamp: new Date().toISOString() });
            } catch (error) {
                h.sendError(ws, error.message, error.code || 'PLAUD_FAILED', message.requestId);
            }
        }, { owner: 'plaud', ...meta });
    };
    reg('plaud_today_list', (m, h) => today.list(h.globalResources));
    reg('plaud_today_summary', (m) => today.summary(m.id));
    reg('plaud_today_review', (m, h) => today.review(h.globalResources, m.id), { destructive: true });
    reg('plaud_today_review_new', (m, h) => today.reviewNew(h.globalResources), { destructive: true });
}

module.exports = { registerPackets };
