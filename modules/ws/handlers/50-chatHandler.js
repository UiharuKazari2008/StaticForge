const wsPacketRegistry = require('../wsPacketRegistry');
const {
    handleCreateChatSession,
    handleGetChatSessions,
    handleGetChatSession,
    handleDeleteChatSession,
    handleRestartChatSession,
    handleSendChatMessage,
    handleUpdateChatContext,
    handleGetChatMessages,
    handleDeleteChatMessage
} = require('./chatImpl');

const CHAT_DESTRUCTIVE = { destructive: true };

/**
 * Register chat session/message WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[50-chatHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'chat', ...meta });
    };

    reg('create_chat_session', handleCreateChatSession, CHAT_DESTRUCTIVE);
    reg('get_chat_sessions', handleGetChatSessions);
    reg('get_chat_session', handleGetChatSession);
    reg('delete_chat_session', handleDeleteChatSession, CHAT_DESTRUCTIVE);
    reg('restart_chat_session', handleRestartChatSession, CHAT_DESTRUCTIVE);
    reg('send_chat_message', handleSendChatMessage, CHAT_DESTRUCTIVE);
    reg('update_chat_context', handleUpdateChatContext, CHAT_DESTRUCTIVE);
    reg('get_chat_messages', handleGetChatMessages);
    reg('delete_chat_message', handleDeleteChatMessage, CHAT_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
