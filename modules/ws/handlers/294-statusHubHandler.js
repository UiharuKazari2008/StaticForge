const wsPacketRegistry = require('../wsPacketRegistry');
const statusHub = require('../statusHub');

// statusHub's subscribe / unsubscribe packets (rule server-push-not-polling.mdc): a client asks for
// a feed while the view that shows it is on screen and gets its current state once; after that the
// feed pushes only changes (feed.pushType). Each feed decides who may subscribe (allow).

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[294-statusHubHandler] registerPackets: missing handlersCtx');
        return;
    }
    statusHub.setSender((ws, packet) => handlersCtx.sendToClient(ws, packet));

    wsPacketRegistry.registerWsPacket('status_subscribe', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        const feed = statusHub.get(String(message.feed || ''));
        if (!feed) {
            handlersCtx.sendError(ws, 'Unknown status feed', 'NOT_FOUND', message.requestId);
            return;
        }
        try {
            const state = await feed.subscribe(ws, clientInfo);
            // the client's request promise resolves with `data` (websocket.js); items stays beside it for older readers
            handlersCtx.sendToClient(ws, { type: 'status_subscribe_response', requestId: message.requestId, feed: feed.name, items: state.items, data: { feed: feed.name, items: state.items }, timestamp: new Date().toISOString() });
        } catch (error) {
            handlersCtx.sendError(ws, error.message, error.code || 'STATUS_SUBSCRIBE_FAILED', message.requestId);
        }
    }, { owner: 'statusHub' });

    wsPacketRegistry.registerWsPacket('status_unsubscribe', async (ctx) => {
        const { ws, message } = ctx;
        const feed = statusHub.get(String(message.feed || ''));
        if (feed) feed.unsubscribe(ws);
        if (message.requestId) handlersCtx.sendToClient(ws, { type: 'status_unsubscribe_response', requestId: message.requestId, ok: true });
    }, { owner: 'statusHub' });
}

module.exports = { registerPackets };
