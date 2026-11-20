const wsPacketRegistry = require('../wsPacketRegistry');
const dreamosUpdates = require('../../dreamosUpdates');

// DreamOS firmware updates (#910, rule server-push-not-polling): a DreamOS desktop (its shell bridge gives the page
// window.DreamOSUpdates) says dreamos_channel_watch once its socket is signed in; when a release is published to a
// channel (dreamosUpdates.js emits 'channel'), only those sockets get dreamos_channel { channel } and hand it to their
// system agent, which checks then (CaféReady firmware.rs). No laptop asks the channel on a timer. Fire-and-forget.

const watching = new Set();

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[312-dreamosUpdatesHandler] registerPackets: missing handlersCtx');
        return;
    }
    wsPacketRegistry.registerWsPacket('dreamos_channel_watch', async (ctx) => {
        const { ws, clientInfo } = ctx;
        if (!ws || !clientInfo || !clientInfo.authenticated || watching.has(ws)) return;
        watching.add(ws);
        ws.once('close', () => watching.delete(ws));
    }, { owner: 'dreamosUpdates' });

    // DreamOS hosts' own carriers (CaféReady's Miniport, no page needed): the frame with their channel's release, to
    // those assigned the channel just published, and to a host whose assignment changed (virtualSocket.js)
    const carriers = (match) => {
        const vs = require('../virtualSocket');
        vs.forEachMiniport((ws) => { if (ws._dsDevice && match(ws)) vs.sendUpdateChannel(ws); });
    };
    dreamosUpdates.events.on('assign', (e) => carriers((ws) => ws._dsDevice === (e && e.device)));
    dreamosUpdates.events.on('channel', (e) => {
        dreamosUpdates.assignments().then((devices) => carriers((ws) => devices[ws._dsDevice] === (e && e.channel))).catch(() => {});
    });

    dreamosUpdates.events.on('channel', (e) => {
        const packet = { type: 'dreamos_channel', data: { channel: e && e.channel }, timestamp: new Date().toISOString() };
        for (const ws of watching) {
            if (ws.readyState !== 1) { watching.delete(ws); continue; }
            try { handlersCtx.sendToClient(ws, packet); } catch (_) { /* gone */ }
        }
    });
}

module.exports = { registerPackets, _test: { watching } };
