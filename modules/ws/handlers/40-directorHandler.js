const wsPacketRegistry = require('../wsPacketRegistry');
const {
    handleDirectorGetSessions,
    handleDirectorCreateSession,
    handleDirectorGetSession,
    handleDirectorDeleteSession,
    handleDirectorSendMessage,
    handleDirectorGetMessages,
    handleDirectorRollbackMessage,
    handleDirectorSaveFeedback,
    handleDirectorLoadRules,
    handleDirectorSaveRules,
    handleDirectorLoadFeedback,
    handleDirectorDeleteFeedback
} = require('./directorImpl');

const DIRECTOR_DESTRUCTIVE = { destructive: true };

/**
 * Register director_* WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[40-directorHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'director', ...meta });
    };

    reg('director_get_sessions', handleDirectorGetSessions);
    reg('director_create_session', handleDirectorCreateSession, DIRECTOR_DESTRUCTIVE);
    reg('director_get_session', handleDirectorGetSession);
    reg('director_delete_session', handleDirectorDeleteSession, DIRECTOR_DESTRUCTIVE);
    reg('director_send_message', handleDirectorSendMessage, DIRECTOR_DESTRUCTIVE);
    reg('director_get_messages', handleDirectorGetMessages);
    reg('director_rollback_message', handleDirectorRollbackMessage, DIRECTOR_DESTRUCTIVE);
    reg('director_save_feedback', handleDirectorSaveFeedback, DIRECTOR_DESTRUCTIVE);
    reg('director_load_rules', handleDirectorLoadRules);
    reg('director_save_rules', handleDirectorSaveRules, DIRECTOR_DESTRUCTIVE);
    reg('director_load_feedback', handleDirectorLoadFeedback);
    reg('director_delete_feedback', handleDirectorDeleteFeedback, DIRECTOR_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
