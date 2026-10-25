const wsPacketRegistry = require('../wsPacketRegistry');
const slideshowDevices = require('../../slideshowDevices');

// Slideshow devices (Yozora #654, modules/slideshowDevices.js): Dreamscape Frame tablets identify,
// report what they show and ack commands (any signed-in session, read-only PIN included); Control
// Panel's Melaton SideShow page lists and drives them (administrators only).

function isAdmin(clientInfo) {
    return !!(clientInfo && clientInfo.authenticated && clientInfo.userType === 'admin');
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[298-slideshowDevicesHandler] registerPackets: missing handlersCtx');
        return;
    }
    const gr = () => handlersCtx.globalResources;
    const reply = (ws, type, message, data) => handlersCtx.sendToClient(ws, { type, requestId: message.requestId, data, timestamp: new Date().toISOString() });
    const reg = (type, fn) => wsPacketRegistry.registerWsPacket(type, fn, { owner: 'slideshowDevices' });

    // ---- device side ----

    reg('client_identify', async ({ ws, message, clientInfo, wsServer }) => {
        try {
            reply(ws, 'client_identify_response', message, slideshowDevices.identify(gr(), wsServer, clientInfo, message.data));
        } catch (error) {
            handlersCtx.sendError(ws, 'Failed to identify the device', error.code || error.message, message.requestId);
        }
    });

    // fire-and-forget: no reply, and a socket that never identified is ignored
    reg('client_device_state', async ({ message, clientInfo, wsServer }) => {
        try {
            slideshowDevices.deviceState(gr(), wsServer, clientInfo, message.data);
        } catch (error) {
            console.warn('[slideshowDevices] client_device_state failed:', error.message);
        }
    });

    reg('device_command_ack', async ({ message, clientInfo }) => {
        slideshowDevices.commandAck(clientInfo, message);
    });

    // ---- Control Panel (admin) ----

    // a read-only logon gets an answer, not an error packet (the desktop shows those as exceptions):
    // the SideShow page then says it cannot change these settings
    reg('list_devices', async ({ ws, message, clientInfo, wsServer }) => {
        if (!isAdmin(clientInfo)) {
            reply(ws, 'list_devices_response', message, { success: false, code: 'INSUFFICIENT_PERMISSIONS', devices: [] });
            return;
        }
        try {
            reply(ws, 'list_devices_response', message, { success: true, devices: slideshowDevices.listDevices(gr(), wsServer) });
        } catch (error) {
            handlersCtx.sendError(ws, 'Failed to list the devices', error.message, message.requestId);
        }
    });

    reg('device_send_command', async ({ ws, message, clientInfo, wsServer }) => {
        if (!isAdmin(clientInfo)) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        const src = message.data && typeof message.data === 'object' ? message.data : message;
        try {
            reply(ws, 'device_send_command_response', message, await slideshowDevices.sendCommand(gr(), wsServer, src));
        } catch (error) {
            reply(ws, 'device_send_command_response', message, { success: false, deviceId: src.deviceId || null, command: src.command || null, error: error.message, code: error.code || 'ERROR' });
        }
    });

    reg('device_forget', async ({ ws, message, clientInfo, wsServer }) => {
        if (!isAdmin(clientInfo)) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        const src = message.data && typeof message.data === 'object' ? message.data : message;
        try {
            reply(ws, 'device_forget_response', message, { success: true, deviceId: src.deviceId, removed: slideshowDevices.forget(gr(), wsServer, src.deviceId) });
        } catch (error) {
            handlersCtx.sendError(ws, 'Failed to forget the device', error.message, message.requestId);
        }
    });
}

module.exports = { registerPackets };
