const wsPacketRegistry = require('../wsPacketRegistry');
const activeSync = require('../../activeSync');

// ActiveSync (Yozora #747, modules/activeSync.js, docs/activesync-protocol.md): a phone (device) and
// a desktop tab (computer) say hello, then call each other through the server. Hello, status,
// replies and events need a signed-in session; calling, listing and partnerships need an
// administrator, on both ends of a call.

function isAdmin(clientInfo) {
    return !!(clientInfo && clientInfo.authenticated && clientInfo.userType === 'admin');
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[301-activeSyncHandler] registerPackets: missing handlersCtx');
        return;
    }
    const gr = () => handlersCtx.globalResources;
    const reply = (ws, type, message, data) => handlersCtx.sendToClient(ws, { type, requestId: message.requestId, data, timestamp: new Date().toISOString() });
    const reg = (type, fn) => wsPacketRegistry.registerWsPacket(type, fn, { owner: 'activeSync' });
    const body = (message) => (message.data && typeof message.data === 'object' ? message.data : message);
    // an expected refusal is an answer (success:false), never an error packet: the desktop shows
    // those as exceptions
    const refused = (error) => ({ success: false, code: error.code || 'ERROR', error: error.message });

    reg('as_hello', async ({ ws, message, clientInfo, wsServer }) => {
        let res;
        try {
            res = activeSync.hello(gr(), wsServer, clientInfo, body(message));
        } catch (error) {
            reply(ws, 'as_hello_response', message, refused(error));
            return;
        }
        // only administrators see the other peers
        if (!isAdmin(clientInfo)) { res.devices = res.device ? [res.device] : []; res.computers = []; }
        reply(ws, 'as_hello_response', message, res);
        if (res.kind === 'device' && res.session === 'partner') {
            activeSync.deliverQueue(gr(), wsServer, res.id).catch((error) => console.warn('[activeSync] queue delivery failed:', error.message));
        }
    });

    // fire-and-forget
    reg('as_status', async ({ message, clientInfo, wsServer }) => {
        try {
            activeSync.status(gr(), wsServer, clientInfo, body(message));
        } catch (error) {
            console.warn('[activeSync] as_status failed:', error.message);
        }
    });

    reg('as_reply', async ({ message, clientInfo }) => {
        activeSync.reply(clientInfo, body(message));
    });

    reg('as_event', async ({ message, clientInfo, wsServer }) => {
        try {
            activeSync.event(gr(), wsServer, clientInfo, body(message));
        } catch (error) {
            console.warn('[activeSync] as_event failed:', error.message);
        }
    });

    reg('as_list', async ({ ws, message, clientInfo, wsServer }) => {
        if (!isAdmin(clientInfo)) {
            reply(ws, 'as_list_response', message, { success: false, code: 'INSUFFICIENT_PERMISSIONS', devices: [], computers: [] });
            return;
        }
        try {
            reply(ws, 'as_list_response', message, { success: true, ...activeSync.list(gr(), wsServer) });
        } catch (error) {
            reply(ws, 'as_list_response', message, { ...refused(error), devices: [], computers: [] });
        }
    });

    reg('as_call', async ({ ws, message, clientInfo, wsServer }) => {
        if (!isAdmin(clientInfo)) {
            reply(ws, 'as_call_response', message, { success: false, code: 'INSUFFICIENT_PERMISSIONS', error: 'Admin access required' });
            return;
        }
        try {
            reply(ws, 'as_call_response', message, await activeSync.call(gr(), wsServer, clientInfo, body(message)));
        } catch (error) {
            reply(ws, 'as_call_response', message, refused(error));
        }
    });

    reg('as_partnership', async ({ ws, message, clientInfo, wsServer }) => {
        if (!isAdmin(clientInfo)) {
            reply(ws, 'as_partnership_response', message, { success: false, code: 'INSUFFICIENT_PERMISSIONS', error: 'Admin access required' });
            return;
        }
        try {
            const res = await activeSync.partnership(gr(), wsServer, clientInfo, body(message));
            reply(ws, 'as_partnership_response', message, res);
            if (res.accepted && res.device && res.device.session === 'partner') {
                activeSync.deliverQueue(gr(), wsServer, res.device.deviceId).catch((error) => console.warn('[activeSync] queue delivery failed:', error.message));
            }
        } catch (error) {
            reply(ws, 'as_partnership_response', message, refused(error));
        }
    });

    reg('as_synced', async ({ ws, message, clientInfo, wsServer }) => {
        const src = body(message);
        const own = clientInfo && clientInfo.as && clientInfo.as.kind === 'device' ? clientInfo.as.id : null;
        const deviceId = own || (isAdmin(clientInfo) ? String(src.deviceId || '') : '');
        reply(ws, 'as_synced_response', message, { success: activeSync.markSynced(gr(), wsServer, deviceId, typeof src.summary === 'string' ? src.summary : '') });
    });

    // Received Items (#803): the phone's own list (or any device's for an admin)
    reg('as_received', async ({ ws, message, clientInfo, wsServer }) => {
        const src = body(message);
        const own = clientInfo && clientInfo.as && clientInfo.as.kind === 'device' ? clientInfo.as.id : null;
        const deviceId = own || (isAdmin(clientInfo) ? String(src.deviceId || '') : '');
        if (!deviceId) { reply(ws, 'as_received_response', message, { success: false, code: 'INSUFFICIENT_PERMISSIONS', items: [] }); return; }
        try {
            if (src.action) {
                activeSync.updateReceived(gr(), wsServer, deviceId, String(src.action), src.id);
            }
            reply(ws, 'as_received_response', message, { success: true, items: activeSync.listReceived(gr(), deviceId), unseen: activeSync.receivedUnseen(gr(), deviceId) });
        } catch (error) {
            reply(ws, 'as_received_response', message, { ...refused(error), items: [] });
        }
    });

    reg('as_log', async ({ ws, message, clientInfo }) => {
        const src = body(message);
        const own = clientInfo && clientInfo.as && clientInfo.as.kind === 'device' ? clientInfo.as.id : null;
        if (!isAdmin(clientInfo) && !own) {
            reply(ws, 'as_log_response', message, { success: false, code: 'INSUFFICIENT_PERMISSIONS', entries: [] });
            return;
        }
        try {
            reply(ws, 'as_log_response', message, { success: true, entries: activeSync.getLog(gr(), isAdmin(clientInfo) ? String(src.deviceId || own || '') : own, src.limit) });
        } catch (error) {
            reply(ws, 'as_log_response', message, { ...refused(error), entries: [] });
        }
    });

    reg('as_forget', async ({ ws, message, clientInfo, wsServer }) => {
        if (!isAdmin(clientInfo)) {
            reply(ws, 'as_forget_response', message, { success: false, code: 'INSUFFICIENT_PERMISSIONS', error: 'Admin access required' });
            return;
        }
        try {
            reply(ws, 'as_forget_response', message, { success: true, removed: activeSync.forget(gr(), wsServer, String(body(message).deviceId || '')) });
        } catch (error) {
            reply(ws, 'as_forget_response', message, refused(error));
        }
    });
}

module.exports = { registerPackets };
