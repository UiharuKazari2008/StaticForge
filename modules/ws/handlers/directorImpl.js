// Director chat is the Cursor project in .cache/dreamscape-director.
// persona: "xi" is the host agent in modules/xiDirector.js.
// Memories rules and feedback stay in directorRules.js.
const cursor = require('../../cursorDirector');
const xi = require('../../xiDirector');
const { submitRequestForm } = require('../../requestForm');
const { submitWorkspaceSwitch } = require('../../sessionWorkspaceSwitch');
const cursorUsage = require('../../cursorUsage');
const legacy = require('../../directorRules');

function isXi(message) {
    return !!(message && message.persona === 'xi');
}

function route(xiFn, cursorFn) {
    return function (handler, ws, message, clientInfo, wsServer) {
        if (isXi(message)) return xiFn(handler, ws, message, clientInfo, wsServer);
        return cursorFn(handler, ws, message, clientInfo, wsServer);
    };
}

module.exports = {
    handleDirectorGetSessions: route(xi.handleDirectorGetSessions, cursor.handleDirectorGetSessions),
    handleDirectorCreateSession: route(xi.handleDirectorCreateSession, cursor.handleDirectorCreateSession),
    handleDirectorGetSession: route(xi.handleDirectorGetSession, cursor.handleDirectorGetSession),
    handleDirectorOpenWorkspace: route(xi.handleDirectorOpenWorkspace, cursor.handleDirectorOpenWorkspace),
    handleDirectorDeleteSession: route(xi.handleDirectorDeleteSession, cursor.handleDirectorDeleteSession),
    handleDirectorForkSession: route(xi.handleDirectorForkSession, cursor.handleDirectorForkSession),
    handleDirectorMoveSession: route(xi.handleDirectorMoveSession, cursor.handleDirectorMoveSession),
    handleDirectorGetMessages: route(xi.handleDirectorGetMessages, cursor.handleDirectorGetMessages),
    handleDirectorRollbackMessage: route(xi.handleDirectorRollbackMessage, cursor.handleDirectorRollbackMessage),
    handleDirectorRecycleSession: cursor.handleDirectorRecycleSession,
    handleDirectorNukeSession: cursor.handleDirectorNukeSession,
    handleDirectorSendMessage: route(xi.handleDirectorSendMessage, cursor.handleDirectorSendMessage),
    handleDirectorGetModels: cursor.handleDirectorGetModels,
    handleDirectorAbort: route(xi.handleDirectorAbort, cursor.handleDirectorAbort),
    handleDirectorToolDiff: xi.handleDirectorToolDiff,
    handleDirectorToolPayload: cursor.handleDirectorToolPayload,
    handleRequestFormSubmit: function (_handler, _ws, message) {
        submitRequestForm(message || {});
    },
    handleWorkspaceSwitchResult: function (_handler, _ws, message) {
        submitWorkspaceSwitch(message || {});
    },
    handleLedgeChecks: function (handler, _ws, message) {
        const ledge = require('../../ledgeDesk');
        const session = ledge.getSession(message && message.sessionId);
        if (!session) return;
        ledge.setChecks(session, message.checked);
        const state = Object.assign({ reason: 'checks' }, ledge.publicSession(session, true));
        let wsServer = null;
        try { wsServer = handler.globalResources.getWebSocketServer(); } catch (_) { wsServer = null; }
        if (wsServer && typeof wsServer.broadcast === 'function') {
            wsServer.broadcast({ type: 'ledge_state', data: state, timestamp: new Date().toISOString() });
        }
    },
    handleDirectorStreamingAck: function (_handler, _ws, message) {
        cursor.ackDirectorStream(message && message.sessionId, message && message.seq);
    },
    handleDirectorComputerSize: cursor.handleDirectorComputerSize,
    handleDirectorComputerStatus: cursor.handleDirectorComputerStatus,
    handleDirectorCleanup: cursor.handleDirectorCleanup,
    handleDirectorReinstall: cursor.handleDirectorReinstall,
    handleDirectorPromptGuideDiff: cursor.handleDirectorPromptGuideDiff,
    handleDirectorPromptGuideExtract: cursor.handleDirectorPromptGuideExtract,
    handleDirectorPromptGuideCommit: cursor.handleDirectorPromptGuideCommit,
    handleDirectorPromptGuidePush: cursor.handleDirectorPromptGuidePush,
    handleDirectorGetCursorUsage: cursorUsage.handleDirectorGetCursorUsage,
    handleDirectorSaveFeedback: legacy.handleDirectorSaveFeedback,
    handleDirectorLoadRules: legacy.handleDirectorLoadRules,
    handleDirectorSaveRules: legacy.handleDirectorSaveRules,
    handleDirectorLoadFeedback: legacy.handleDirectorLoadFeedback,
    handleDirectorDeleteFeedback: legacy.handleDirectorDeleteFeedback
};
