const wsPacketRegistry = require('../wsPacketRegistry');
const xlink = require('../../xlink');

// XLink Operator Console (apps/xlink, Yozora #719): the arcade cabinets' menu (menu.json), their
// statuses and actions, all fetched here (modules/xlink.js). Administrators only.

const isAdmin = (info) => !!info && (info.userType === 'admin' || info.userType === 'dev_admin');

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[297-xlinkHandler] registerPackets: missing handlersCtx');
        return;
    }
    const packet = (type, run, failure) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo } = ctx;
            if (!isAdmin(clientInfo)) {
                handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }
            // sendMessage spreads its fields onto the packet; a cabinet that fails is the console's
            // business (its own System Error box), so failures come back in the reply, not as an error
            // packet (that would raise the desktop's Mainframe exception dialog)
            let data;
            try {
                data = await run(message);
            } catch (error) {
                data = { error: { message: failure, details: error.message, code: error.code || '' } };
            }
            handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
        }, { owner: 'xlink' });
    };

    packet('xlink_info', async () => xlink.info(), 'Failed to read XLink');
    packet('xlink_devices', async () => ({ devices: await xlink.devices() }), 'Failed to read the device list');
    packet('xlink_device', async (d) => xlink.device(String(d.device || ''), { force: !!d.force }), 'Failed to poll the device');
    packet('xlink_action', async (d) => xlink.action({
        device: String(d.device || ''),
        path: d.path,
        op: d.op,
        value: d.value,
        confirmed: !!d.confirmed
    }), 'The device did not accept the command');
    packet('xlink_save', async (d) => xlink.saveFile(String(d.name || ''), String(d.text || '')), 'Failed to save the configuration');
}

module.exports = { registerPackets };
