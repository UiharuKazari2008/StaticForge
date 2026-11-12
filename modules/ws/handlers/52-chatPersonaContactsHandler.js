const wsPacketRegistry = require('../wsPacketRegistry');
const personaContacts = require('../../chatPersonaContacts');

/**
 * Chat persona contact cards (Yozora #763, modules/chatPersonaContacts.js).
 *
 *   get_chat_persona_state { chatId }           the persona's state for its card (Contacts'
 *                                               Persona page, the phone's contact card)
 *   chat_persona_contacts_backfill { workspaceId, dryRun }
 *                                               one-off: a card for every chat without one, all in
 *                                               that workspace's Contacts folder
 */
async function handleGetChatPersonaState(handlers, ws, message) {
    try {
        const data = message.data || message;
        const chatId = Number(data.chatId);
        if (!Number.isInteger(chatId) || chatId <= 0) {
            handlers.sendError(ws, 'Chat ID is required', null, message.requestId);
            return;
        }
        const state = await personaContacts.getPersonaState(chatId);
        handlers.sendToClient(ws, {
            type: 'get_chat_persona_state_response',
            requestId: message.requestId,
            data: { success: true, state },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error getting chat persona state:', error);
        handlers.sendError(ws, 'Failed to get the persona state', error.message, message.requestId);
    }
}

async function handleBackfill(handlers, ws, message) {
    try {
        const data = message.data || message;
        const result = await personaContacts.backfill({ workspaceId: String(data.workspaceId || ''), dryRun: data.dryRun === true });
        handlers.sendToClient(ws, {
            type: 'chat_persona_contacts_backfill_response',
            requestId: message.requestId,
            data: { success: true, ...result },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error making chat persona contacts:', error);
        handlers.sendError(ws, 'Failed to make the persona contacts', error.message, message.requestId);
    }
}

/**
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[52-chatPersonaContactsHandler] registerPackets: missing handlersCtx');
        return;
    }
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'chat', ...meta });
    };
    reg('get_chat_persona_state', handleGetChatPersonaState);
    reg('chat_persona_contacts_backfill', handleBackfill, { destructive: true });
}

module.exports = {
    registerPackets
};
