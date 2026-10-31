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
    handleDirectorCustomProvidersGet,
    handleDirectorCustomProvidersSave,
    handleDirectorCustomProvidersBalance,
    handleRentanAgentGet,
    handleRentanAgentSetDefault,
    handleDirectorAbort,
    handleDirectorComputerSize,
    handleDirectorComputerStatus,
    handleDirectorCleanup,
    handleDirectorReinstall,
    handleDirectorPromptGuideDiff,
    handleDirectorPromptGuideExtract,
    handleDirectorPromptGuideCommit,
    handleDirectorPromptGuidePush,
    handleDirectorRepairSession,
    handleDirectorLearnedList,
    handleDirectorLearnedDecide,
    handleDirectorLearnedRuleEdit,
    handleDirectorLearnedRuleRemove,
    handleDirectorSettingsGet,
    handleDirectorSettingsSet,
    handleDirectorGetCursorUsage,
    handleDirectorGetMessages,
    handleDirectorRollbackMessage,
    handleDirectorRecycleSession,
    handleDirectorNukeSession,
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
        // A handler missing from directorImpl used to register and then throw "fn is not a function" per packet.
        if (typeof fn !== 'function') {
            console.error(`[40-directorHandler] ${type}: no handler exported from directorImpl; not registered`);
            return;
        }
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
    reg('director_custom_providers_get', handleDirectorCustomProvidersGet);
    reg('director_custom_providers_save', handleDirectorCustomProvidersSave, DIRECTOR_DESTRUCTIVE);
    reg('director_custom_providers_balance', handleDirectorCustomProvidersBalance);
    // Rentan menu: the saved default engine / model / reasoning / fast for every Rentan turn (#409).
    reg('director_rentan_agent_get', handleRentanAgentGet);
    reg('director_rentan_agent_set_default', handleRentanAgentSetDefault, DIRECTOR_DESTRUCTIVE);
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
    reg('director_nuke_session', handleDirectorNukeSession, DIRECTOR_DESTRUCTIVE);
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

    // Auto-Repair Session (#687): a hidden turn restates the chat into a new session.
    // Its rule and guide proposals change nothing until approved here.
    reg('director_repair_session', handleDirectorRepairSession, DIRECTOR_DESTRUCTIVE);
    reg('director_learned_list', handleDirectorLearnedList);
    reg('director_learned_decide', handleDirectorLearnedDecide, DIRECTOR_DESTRUCTIVE);
    reg('director_learned_rule_edit', handleDirectorLearnedRuleEdit, DIRECTOR_DESTRUCTIVE);
    reg('director_learned_rule_remove', handleDirectorLearnedRuleRemove, DIRECTOR_DESTRUCTIVE);

    // Director Settings: new-chat defaults per tab (Wren, Kabuki), Auto-Repair, the repair engines.
    reg('director_settings_get', handleDirectorSettingsGet);
    reg('director_settings_set', handleDirectorSettingsSet, DIRECTOR_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
