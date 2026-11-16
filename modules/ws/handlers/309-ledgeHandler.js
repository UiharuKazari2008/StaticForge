const wsPacketRegistry = require('../wsPacketRegistry');
const ledge = require('../../ledgeDesk');

// Ledge desks (modules/ledgeDesk.js) from a client: the user's own desks in the workspace the client
// is in. Changes go to the desk's owner client as ledge_state (the Director session's device);
// the asking client gets the _response.
//
//   ledge_list    { workspaceId?, all? }        -> { workspaceId, sessions: [desk head] }
//   ledge_get     { sessionId }                 -> { session: full desk (items, checked) }
//   ledge_checks  { sessionId, checked: [itemId] }  -> { session: head }   (ledge_state 'checks')
//   ledge_remove  { sessionId, itemId | index } -> { removed, session: head } (ledge_state 'remove')
//   ledge_clear   { sessionId }                 -> { session: head }   (ledge_state 'clear')
//   ledge_rename  { sessionId, name }           -> { session: head }   (ledge_state 'rename')
//   ledge_dispose { sessionId }                 -> { disposed: true }  (ledge_state 'dispose')
//
// A desk head is { sessionId, name, workspaceId, kind, chatId, count, rev, updatedAt, checked }.

function reply(h, ws, message, data) {
    h.sendToClient(ws, { type: `${message.type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
}

function clientWorkspace(gr, info) {
    try {
        const manager = gr.getWorkspaceManager();
        if (info && info.sessionId && manager && typeof manager.getActiveWorkspace === 'function') {
            return manager.getActiveWorkspace(info.sessionId) || 'default';
        }
    } catch (_) { /* no workspace manager yet */ }
    return 'default';
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[309-ledgeHandler] registerPackets: missing handlersCtx');
        return;
    }
    const gr = handlersCtx.globalResources;
    // desks are read from .cache/ledge at start
    ledge.bind(gr);
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            if (!ctx.clientInfo || ctx.clientInfo.authenticated === false) {
                handlersCtx.sendError(ctx.ws, 'Sign in first', 'AUTH_REQUIRED', ctx.message.requestId);
                return;
            }
            await fn(ctx, ledge.userOfInfo(ctx.clientInfo));
        }, { owner: 'ledge', ...meta });
    };
    const withDesk = (fn) => (ctx, user) => {
        const desk = ledge.getSession(user, ctx.message.sessionId);
        if (!desk) {
            reply(handlersCtx, ctx.ws, ctx.message, { success: false, error: 'Unknown Ledge session', code: 'LEDGE_UNKNOWN' });
            return;
        }
        fn(ctx, desk, user);
    };

    reg('ledge_list', (ctx, user) => {
        const m = ctx.message;
        const workspaceId = m.all === true ? '' : String(m.workspaceId || clientWorkspace(gr, ctx.clientInfo));
        reply(handlersCtx, ctx.ws, m, { success: true, workspaceId: workspaceId || null, sessions: ledge.listSessions(user, workspaceId) });
    });
    reg('ledge_get', withDesk((ctx, desk) => {
        reply(handlersCtx, ctx.ws, ctx.message, { success: true, session: ledge.fullPacket(desk, 'sync', false) });
    }));
    reg('ledge_checks', withDesk((ctx, desk) => {
        const baseRev = desk.rev;
        ledge.setChecks(desk, ctx.message.checked);
        const data = ledge.packet(desk, 'checks', { baseRev, checked: desk.items.filter((item) => item.checked).map((item) => item.id) });
        ledge.deliver(desk, data);
        reply(handlersCtx, ctx.ws, ctx.message, { success: true, session: ledge.publicSession(desk, false) });
    }));
    reg('ledge_remove', withDesk((ctx, desk) => {
        const m = ctx.message;
        const baseRev = desk.rev;
        const removed = ledge.removeItem(desk, m.itemId != null ? String(m.itemId) : m.index);
        if (!removed) {
            reply(handlersCtx, ctx.ws, m, { success: false, error: 'No such item', code: 'LEDGE_NO_ITEM' });
            return;
        }
        ledge.deliver(desk, ledge.packet(desk, 'remove', { baseRev, removed: { index: removed.index, id: removed.id } }));
        reply(handlersCtx, ctx.ws, m, { success: true, removed, session: ledge.publicSession(desk, false) });
    }), { destructive: true });
    reg('ledge_clear', withDesk((ctx, desk) => {
        const baseRev = desk.rev;
        ledge.clearSession(desk);
        ledge.deliver(desk, ledge.packet(desk, 'clear', { baseRev }));
        reply(handlersCtx, ctx.ws, ctx.message, { success: true, session: ledge.publicSession(desk, false) });
    }), { destructive: true });
    reg('ledge_rename', withDesk((ctx, desk) => {
        const baseRev = desk.rev;
        if (!ledge.renameSession(desk, ctx.message.name)) {
            reply(handlersCtx, ctx.ws, ctx.message, { success: false, error: 'A new name is required', code: 'LEDGE_NAME' });
            return;
        }
        ledge.deliver(desk, ledge.packet(desk, 'rename', { baseRev }));
        reply(handlersCtx, ctx.ws, ctx.message, { success: true, session: ledge.publicSession(desk, false) });
    }));
    reg('ledge_dispose', withDesk((ctx, desk, user) => {
        const data = ledge.packet(desk, 'dispose', { disposed: true, count: 0 });
        ledge.disposeSession(user, desk.id);
        ledge.deliver(desk, data);
        reply(handlersCtx, ctx.ws, ctx.message, { success: true, disposed: true, sessionId: desk.id });
    }), { destructive: true });
}

module.exports = { registerPackets };
