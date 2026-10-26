const wsPacketRegistry = require('../wsPacketRegistry');
const slideshowDevices = require('../../slideshowDevices');
const searchHandler = require('./70-searchHandler');

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

    const imageCtx = (clientInfo) => ({
        metadataDb: gr().getMetadataDatabase(),
        workspaceManager: gr().getWorkspaceManager(),
        sessionId: clientInfo && clientInfo.sessionId,
        runSearch: (query) => searchHandler.omegasearchMatchFilenames(handlersCtx, clientInfo && clientInfo.sessionId, query)
    });

    // the device's pictures for its stored settings (workspaces, age, Image Search), newest first
    reg('device_slideshow_images', async ({ ws, message, clientInfo }) => {
        try {
            const deviceId = clientInfo && clientInfo.deviceId;
            if (!deviceId) {
                reply(ws, 'device_slideshow_images_response', message, { success: false, code: 'NOT_IDENTIFIED', total: 0, items: [] });
                return;
            }
            const settings = slideshowDevices.deviceSettings(gr(), deviceId) || {};
            const res = await slideshowDevices.resolveImages(imageCtx(clientInfo), settings);
            reply(ws, 'device_slideshow_images_response', message, { success: true, deviceId, ...res });
        } catch (error) {
            handlersCtx.sendError(ws, 'Failed to list the pictures', error.message, message.requestId);
        }
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

    // Control Panel's preview: what a device would show with these (unsaved) settings, and the workspaces
    reg('device_preview_images', async ({ ws, message, clientInfo }) => {
        if (!isAdmin(clientInfo)) {
            reply(ws, 'device_preview_images_response', message, { success: false, code: 'INSUFFICIENT_PERMISSIONS', total: 0, items: [] });
            return;
        }
        const src = message.data && typeof message.data === 'object' ? message.data : message;
        try {
            const stored = slideshowDevices.isDeviceId(src.deviceId) ? (slideshowDevices.deviceSettings(gr(), String(src.deviceId)) || {}) : {};
            const settings = Object.assign({}, stored, slideshowDevices.sanitizeSettings(src.settings));
            const res = await slideshowDevices.resolveImages(imageCtx(clientInfo), settings);
            const all = gr().getWorkspaceManager().getWorkspaces() || {};
            const workspaces = Object.entries(all).map(([id, w]) => ({ id, name: (w && w.name) || id }));
            reply(ws, 'device_preview_images_response', message, { success: true, total: res.total, items: res.items.slice(0, Number(src.limit) > 0 ? Math.min(60, Number(src.limit)) : 12), workspaces });
        } catch (error) {
            reply(ws, 'device_preview_images_response', message, { success: false, error: error.message, total: 0, items: [] });
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
