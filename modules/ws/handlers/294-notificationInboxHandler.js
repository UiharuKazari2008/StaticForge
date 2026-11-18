const wsPacketRegistry = require('../wsPacketRegistry');
const inbox = require('../../notificationInbox');
const reminders = require('../../reminderScheduler');

// Notification inbox (Yozora #845): the durable store of notices (modules/notificationInbox.js), so
// the shell shows on resume what was not cleared or acted on elsewhere, and the DSApp foreground
// service can post them as Android notifications while the WebView is paused. admin / dev_admin only;
// each userType has its own queue.
//
//   inbox_list   { since?, includeCleared? }   -> { notices, total } (newest first, not expired); since (ms):
//                only the rows created or changed at or after it, cleared ones included (#890 round 5, W2)
//   inbox_ack    { id, state: 'seen'|'acted'|'cleared', device? }   -> { ok }
//   inbox_prefs  { quiet: [class...] }   -> { ok, quiet } (the phone's Display message off classes)
//   reminder_snooze  { id, minutes? | at? }   -> { ok, at } (a 'reminder' notice comes back then, #876)
//   reminder_dismiss { id }   -> { ok } (dismissed in the desktop Calendar: never fires, notice cleared)
//   reminder_status  {}   -> { started, next, snoozed, lastScanAt, lastError } (the scheduler's queue)
//
// Broadcast to the same userType's phone pages (websocket.js PHONE_ONLY_TYPES):
//   inbox_updated  { reason: 'new'|'ack', notice? | id, state?, device? }
//   an ack only for 'acted' / 'cleared' (a 'seen' changes nothing a page shows); an ack skips a sleeping
//   page, which lists with since when it wakes (#890 round 5, W7)

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
    // the phones' status icons, worked out here and sent over their background links (#908)
    try { require('../../phoneStatus').bind(handlersCtx.globalResources); } catch (e) { console.warn(`[294-notificationInboxHandler] phone status: ${e.message}`); }
    // the household mailbox's deliveries raise their own notices (#908)
    try { require('../../notificationInboxSources').bindDovecote(); } catch (e) { console.warn(`[294-notificationInboxHandler] dovecote: ${e.message}`); }
    // calendar appointment and task reminders fire from the server (#876)
    try { reminders.start(handlersCtx.globalResources); } catch (e) { console.warn(`[294-notificationInboxHandler] reminders: ${e.message}`); }
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
        const user = inbox.userOf(ctx.clientInfo);
        reply(handlersCtx, ctx.ws, m, { notices: inbox.list(user, { since: Number(m.since) || 0, includeCleared: !!m.includeCleared }), total: inbox.count(user) });
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
    // Messaging > Tools > Options "status icon for any unread mail / text" (#908): kept here so the phones' status icons
    // (phoneStatus, worked out on the server, drawn by the app with the page asleep) follow it
    reg('phone_status_prefs', (ctx) => {
        const m = ctx.message;
        const user = inbox.userOf(ctx.clientInfo);
        if (typeof m.mailAll === 'boolean') inbox.setPref(user, 'icon.mailAll', m.mailAll ? '1' : '0');
        if (typeof m.smsAll === 'boolean') inbox.setPref(user, 'icon.smsAll', m.smsAll ? '1' : '0');
        reply(handlersCtx, ctx.ws, m, { ok: true });
    });
    reg('reminder_snooze', (ctx) => {
        const m = ctx.message;
        reply(handlersCtx, ctx.ws, m, reminders.snooze(inbox.userOf(ctx.clientInfo), String(m.id || ''), { minutes: m.minutes, at: m.at }));
    }, { destructive: true });
    reg('reminder_dismiss', (ctx) => {
        const m = ctx.message;
        reply(handlersCtx, ctx.ws, m, reminders.dismiss(inbox.userOf(ctx.clientInfo), String(m.id || '')));
    }, { destructive: true });
    reg('reminder_status', (ctx) => {
        reply(handlersCtx, ctx.ws, ctx.message, reminders.status());
    });
}

module.exports = { registerPackets };
