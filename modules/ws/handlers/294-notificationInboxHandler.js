const wsPacketRegistry = require('../wsPacketRegistry');
const inbox = require('../../notificationInbox');

// Notification inbox (Yozora #845): the durable store of notices (modules/notificationInbox.js), so
// the shell shows on resume what was not cleared or acted on elsewhere, and the DSApp foreground
// service can post them as Android notifications while the WebView is paused. admin / dev_admin only;
// each userType has its own queue.
//
//   inbox_list   { since?, includeCleared? }   -> { notices } (newest first, not expired)
//   inbox_ack    { id, state: 'seen'|'acted'|'cleared', device? }   -> { ok }
//   inbox_prefs  { quiet: [class...] }   -> { ok, quiet } (the phone's Display message off classes)
//
// Broadcast to the same userType's clients:
//   inbox_updated  { reason: 'new'|'ack', notice? | id, state?, device? }

const canUse = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));

function reply(h, ws, message, data) {
    h.sendToClient(ws, { type: `${message.type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[294-notificationInboxHandler] registerPackets: missing handlersCtx');
        return;
    }
    inbox.bind(handlersCtx.globalResources);
    // the phone's print notifications come from the FIFO itself (#876)
    try {
        const gr = handlersCtx.globalResources;
        const queue = gr && typeof gr.getGenerationJobQueue === 'function' ? gr.getGenerationJobQueue() : require('../../generationJobQueue').getSharedGenerationJobQueue();
        require('../../notificationInboxSources').bindPrintQueue(queue);
    } catch (e) { console.warn(`[294-notificationInboxHandler] print queue: ${e.message}`); }
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            if (!canUse(ctx.clientInfo)) {
                handlersCtx.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', ctx.message.requestId);
                return;
            }
            await fn(ctx);
        }, { owner: 'notification-inbox', ...meta });
    };
    reg('inbox_list', (ctx) => {
        const m = ctx.message;
        reply(handlersCtx, ctx.ws, m, { notices: inbox.list(inbox.userOf(ctx.clientInfo), { since: m.since || 0, includeCleared: !!m.includeCleared }) });
    });
    reg('inbox_ack', (ctx) => {
        const m = ctx.message;
        const ok = inbox.ack(inbox.userOf(ctx.clientInfo), String(m.id || ''), String(m.state || ''), m.device || ctx.clientInfo.clientId);
        reply(handlersCtx, ctx.ws, m, { ok });
    }, { destructive: true });
    // the phone's Sounds & Notifications "Display message on screen" choices: classes shown without a
    // message are stored seen and never posted on Android (#876)
    reg('inbox_prefs', (ctx) => {
        const m = ctx.message;
        const quiet = inbox.setQuiet(inbox.userOf(ctx.clientInfo), Array.isArray(m.quiet) ? m.quiet : []);
        reply(handlersCtx, ctx.ws, m, { ok: !!quiet, quiet: quiet || [] });
    });
}

module.exports = { registerPackets };
