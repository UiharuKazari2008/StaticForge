const wsPacketRegistry = require('../wsPacketRegistry');
const xlink = require('../../xlink');
const statusHub = require('../statusHub');

// XLink Operator Console (apps/xlink, Yozora #719): the arcade cabinets' menu (menu.json), their
// statuses and actions, all fetched here (modules/xlink.js). Administrators only.

const isAdmin = (info) => !!info && (info.userType === 'admin' || info.userType === 'dev_admin');

// The cabinets' status for every XLink view (Today's item, the console), read here once a minute
// while any of them is on screen and pushed only when something changed (statusHub, rule
// server-push-not-polling). Each phone used to re-read every cabinet itself every 60 s.
// items: { '#list': [device summaries], <device key>: full snapshot without its request log }
const feed = statusHub.define({
    name: 'xlink',
    pushType: 'xlink_status',
    intervalMs: 60000,
    allow: isAdmin,
    async sample() {
        const list = await xlink.devices();
        const items = { '#list': list };
        await Promise.all(list.map(async (d) => {
            try {
                const snap = await xlink.device(d.key, { force: true });
                const { log, polledAt, cached, ...rest } = snap || {};
                items[d.key] = rest;
            } catch (error) {
                items[d.key] = { key: d.key, error: error.message };
            }
        }));
        return items;
    }
});

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
    packet('xlink_action', async (d) => {
        const r = await xlink.action({
            device: String(d.device || ''),
            path: d.path,
            op: d.op,
            value: d.value,
            confirmed: !!d.confirmed
        });
        // the other XLink views see the change at once
        feed.poke();
        return r;
    }, 'The device did not accept the command');
    packet('xlink_save', async (d) => xlink.saveFile(String(d.name || ''), String(d.text || '')), 'Failed to save the configuration');
}

module.exports = { registerPackets };
