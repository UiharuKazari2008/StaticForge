'use strict';

/**
 * Today's Recordings item (#1144; modules/plaudToday.js). Admin only; the page never reads Plaud itself.
 *   plaud_today_list                 -> { linked, recordings[{ id, name, createdAt, startAt, durationMs, source, review }], battery, device, lastRead, stale, waiting, reviewing, lastSync, deviceLogin }
 *     (device { name, model } | null, battery 0-100 | null, lastSync ms | null: the recorder, from Plaud's web page in the server's browser (plaudDevice.js); battery and lastSync stay null, Plaud's cloud has neither;
 *      deviceLogin 'ok' | 'missing' (that browser is not signed in to Plaud) | 'unknown'; stale: true = Plaud was unreachable, the kept list with its older lastRead)
 *   plaud_today_summary { id }       -> { id, name, title, summary, review }
 *   plaud_today_review { id }        -> { sessionId, started, deduped, review }   (one agent session; a second press only returns it)
 *   plaud_today_review_new           -> { sessionId, started, deduped, count, review } | { started: false, none: true, count: 0, waiting: 0 }   (one chat for every unreviewed recording)
 * review = null | { sessionId, status: 'running' | 'idle', issues[], updatedAt }. docs/client-api/ws/account.md#plaud
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const today = require('../../plaudToday');

function registerPackets(handlersCtx) {
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
