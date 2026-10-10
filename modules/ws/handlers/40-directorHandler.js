// Director chat runs the local Cursor agent. Rules/feedback still use directorRules.js.
const wsPacketRegistry = require('../wsPacketRegistry');
const {
    handleDirectorGetSessions,
    handleDirectorCreateSession,
    handleDirectorGetSession,
    handleDirectorOpenWorkspace,
    handleDirectorDeleteSession,
    handleDirectorForkSession,
    handleDirectorMoveSession,
    handleDirectorSendMessage,
    handleDirectorGetModels,
    handleDirectorAbort,
    handleDirectorComputerSize,
    handleDirectorComputerStatus,
    handleDirectorCleanup,
    handleDirectorReinstall,
    handleDirectorPromptGuideDiff,
    handleDirectorPromptGuideExtract,
    handleDirectorPromptGuideCommit,
    handleDirectorPromptGuidePush,
    handleDirectorGetCursorUsage,
    handleDirectorGetMessages,
    handleDirectorRollbackMessage,
    handleDirectorRecycleSession,
    handleDirectorToolDiff,
    handleDirectorToolPayload,
    handleRequestFormSubmit,
    handleWorkspaceSwitchResult,
    handleLedgeChecks,
    handleDirectorStreamingAck,
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
    reg('director_open_workspace', handleDirectorOpenWorkspace, DIRECTOR_DESTRUCTIVE);
    reg('director_create_session', handleDirectorCreateSession, DIRECTOR_DESTRUCTIVE);
    reg('director_get_session', handleDirectorGetSession);
    reg('director_delete_session', handleDirectorDeleteSession, DIRECTOR_DESTRUCTIVE);
    reg('director_fork_session', handleDirectorForkSession, DIRECTOR_DESTRUCTIVE);
    reg('director_move_session', handleDirectorMoveSession, DIRECTOR_DESTRUCTIVE);
    reg('director_send_message', handleDirectorSendMessage, DIRECTOR_DESTRUCTIVE);
    reg('director_get_models', handleDirectorGetModels);
    reg('director_abort', handleDirectorAbort, DIRECTOR_DESTRUCTIVE);
    reg('director_get_messages', handleDirectorGetMessages);
    reg('director_tool_diff', handleDirectorToolDiff);
    reg('director_tool_payload', handleDirectorToolPayload);
    reg('request_form_submit', handleRequestFormSubmit);
    reg('director_workspace_switch_result', handleWorkspaceSwitchResult);
    reg('ledge_checks', handleLedgeChecks);
    reg('director_streaming_ack', handleDirectorStreamingAck);
    reg('director_get_cursor_usage', handleDirectorGetCursorUsage);
    // Tray icon state and the tray resource line. Read-only, so not destructive.
    reg('director_computer_status', handleDirectorComputerStatus);
    reg('director_rollback_message', handleDirectorRollbackMessage, DIRECTOR_DESTRUCTIVE);
    reg('director_recycle_session', handleDirectorRecycleSession, DIRECTOR_DESTRUCTIVE);
    reg('director_save_feedback', handleDirectorSaveFeedback, DIRECTOR_DESTRUCTIVE);
    reg('director_load_rules', handleDirectorLoadRules);
    reg('director_save_rules', handleDirectorSaveRules, DIRECTOR_DESTRUCTIVE);
    reg('director_load_feedback', handleDirectorLoadFeedback);
    reg('director_delete_feedback', handleDirectorDeleteFeedback, DIRECTOR_DESTRUCTIVE);

    // User-only maintenance of the Director's bubblewrap computer and the
    // writable prompt-guide clone. The agent has no MCP tool for any of these.
    reg('director_computer_size', handleDirectorComputerSize, DIRECTOR_DESTRUCTIVE);
    reg('director_cleanup', handleDirectorCleanup, DIRECTOR_DESTRUCTIVE);
    reg('director_reinstall', handleDirectorReinstall, DIRECTOR_DESTRUCTIVE);
    reg('director_prompt_guide_diff', handleDirectorPromptGuideDiff, DIRECTOR_DESTRUCTIVE);
    reg('director_prompt_guide_extract', handleDirectorPromptGuideExtract, DIRECTOR_DESTRUCTIVE);
    reg('director_prompt_guide_commit', handleDirectorPromptGuideCommit, DIRECTOR_DESTRUCTIVE);
    reg('director_prompt_guide_push', handleDirectorPromptGuidePush, DIRECTOR_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
