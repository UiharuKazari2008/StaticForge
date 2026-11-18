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

// A test device's snooze (modules/testDevices.js): the notice goes now and comes back as itself, sounding, like the
// household's (reminderScheduler.snooze) but held in memory only - a test lane notice is never worth a scheduler row.
function testSnooze(id, m) {
    const held = id && inbox.list('test', { includeCleared: true }).find((n) => n.id === id);
    if (!held) return { ok: false, error: 'no notice' };
    const now = Date.now();
    const at = Number.isFinite(Number(m.at)) && Number(m.at) > now ? Number(m.at) : now + Math.max(1, Math.min(1440, Number(m.minutes) || 5)) * 60000;
    inbox.clear('test', id, 'snooze');
    const t = setTimeout(() => {
        inbox.publish({ user: 'test', id, app: held.app, cls: held.cls, title: held.title, text: held.text, actions: held.actions, data: held.data, alert: true });
    }, at - now);
    if (t.unref) t.unref();
    return { ok: true, at, test: true };
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
            // the Android app's background link sends its fields in data (ActiveSyncLink.request: a reminder's Snooze /
            // Dismiss from its notification, #908); pages send them on the packet
            const m = ctx.message;
            if (m && m.data && typeof m.data === 'object' && !Array.isArray(m.data)) ctx = Object.assign({}, ctx, { message: Object.assign({}, m.data, m) });
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
    // the envelope icons' "new since last opened" (#907, modules/messageNew.js): a page asks once at start, the server
    // pushes msg_new_state on change; opening the mail / Text Messaging on a phone says so
    reg('msg_new_state', (ctx) => {
        reply(handlersCtx, ctx.ws, ctx.message, require('../../messageNew').state());
    });
    reg('msg_new_seen', (ctx) => {
        const m = ctx.message;
        // a test device (modules/testDevices.js) opening its mail says nothing about the household's envelope icons
        if (inbox.userOf(ctx.clientInfo) === 'test') { reply(handlersCtx, ctx.ws, m, { ok: true, test: true }); return; }
        reply(handlersCtx, ctx.ws, m, { ok: require('../../messageNew').seen(String(m.cls || '')) });
    });
    // the test lane's snooze and dismiss stay in it: the household's reminder scheduler is never told
    reg('reminder_snooze', (ctx) => {
        const m = ctx.message;
        const user = inbox.userOf(ctx.clientInfo);
        if (user === 'test') { reply(handlersCtx, ctx.ws, m, testSnooze(String(m.id || ''), m)); return; }
        reply(handlersCtx, ctx.ws, m, reminders.snooze(user, String(m.id || ''), { minutes: m.minutes, at: m.at }));
    }, { destructive: true });
    reg('reminder_dismiss', (ctx) => {
        const m = ctx.message;
        const user = inbox.userOf(ctx.clientInfo);
        if (user === 'test') { reply(handlersCtx, ctx.ws, m, { ok: true, cleared: inbox.clear('test', String(m.id || ''), 'test') }); return; }
        reply(handlersCtx, ctx.ws, m, reminders.dismiss(user, String(m.id || '')));
    }, { destructive: true });
    reg('reminder_status', (ctx) => {
        reply(handlersCtx, ctx.ws, ctx.message, reminders.status());
    });
}

module.exports = { registerPackets };
