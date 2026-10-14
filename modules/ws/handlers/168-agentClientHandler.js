const wsPacketRegistry = require('../wsPacketRegistry');
const agentClientBridge = require('../../agentClientBridge');

async function handleSessionShareStart(handlers, ws, message, clientInfo) {
    try {
        agentClientBridge.handleSessionShareStart(handlers, ws, message, clientInfo);
    } catch (_error) {
        handlers.sendError(ws, 'Failed to start session share', 'session_share_start', message.requestId);
    }
}

async function handleAgentSessionResult(handlers, ws, message) {
    try {
        agentClientBridge.handleAgentSessionResult(handlers, ws, message);
    } catch (_error) {
        // Client replies are fire-and-forget; ignore bad payloads.
    }
}

/**
 * Register localhost agent-session WebSocket packet handlers.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[168-agentClientHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, owner, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner, ...meta });
    };

    reg('session_share_start', 'agentSession', handleSessionShareStart);
    reg('agent_session_result', 'agentSession', handleAgentSessionResult);
    reg('agent_session_unbind', 'agentSession', (handlers, ws, message, clientInfo) => {
        agentClientBridge.handleAgentSessionUnbind(handlers, ws, message, clientInfo);
    });
    // Priority client for development (Run: agent, Remote Access: Priority Client)
    reg('agent_priority_client', 'agentSession', (handlers, ws, message, clientInfo) => {
        agentClientBridge.handleAgentPriorityClient(handlers, ws, message, clientInfo);
    });
    // Desktop readiness (#475): the tab reports logon / booting / locked / desktop / ready
    reg('client_desktop_state', 'agentSession', (handlers, ws, message, clientInfo) => {
        agentClientBridge.handleClientDesktopState(handlers, ws, message, clientInfo);
    });
}

module.exports = {
    registerPackets
};
