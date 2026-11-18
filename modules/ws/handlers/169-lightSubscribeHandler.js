const wsPacketRegistry = require('../wsPacketRegistry');

// light_subscribe { types: [type] } (#908): a light socket (?light=1, or a light Miniport sub-client: the
// Android app's CaféReady task host) says which broadcast types it hears; every other broadcast skips it
// (websocket.js socketWantsBroadcast). Replaces the set (at most 64 types). Reply { types }.
// Statushub feeds are not broadcasts: status_subscribe as for any client.

const TYPE_RE = /^[a-z][a-z0-9_]{0,63}$/;

function registerPackets() {
    wsPacketRegistry.registerWsPacket('light_subscribe', async (ctx) => {
        const { ws, message, clientInfo, handlers } = ctx;
        if (!clientInfo || !clientInfo.authenticated || !clientInfo.light) {
            if (handlers && typeof handlers.sendError === 'function') handlers.sendError(ws, 'Only light sockets subscribe this way', 'NOT_LIGHT', message && message.requestId);
            return;
        }
        const src = Array.isArray(message && message.types) ? message.types : [];
        const types = new Set();
        for (const t of src.slice(0, 64)) if (typeof t === 'string' && TYPE_RE.test(t)) types.add(t);
        clientInfo.lightSubs = types;
        if (handlers && typeof handlers.sendToClient === 'function') {
            handlers.sendToClient(ws, { type: 'light_subscribe_response', requestId: message && message.requestId, data: { types: [...types] }, timestamp: new Date().toISOString() });
        }
    }, { owner: 'lightSubscribe' });
}

module.exports = { registerPackets };
