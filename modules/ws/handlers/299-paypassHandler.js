const wsPacketRegistry = require('../wsPacketRegistry');
const paypass = require('../../paypass');

// PayPass Operator (apps/paypass, Yozora #721): openCreditIC, the arcade's IC card / credit system,
// reached through its web API from here (modules/paypass.js). Administrators only.

const isAdmin = (info) => !!info && (info.userType === 'admin' || info.userType === 'dev_admin');

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[299-paypassHandler] registerPackets: missing handlersCtx');
        return;
    }
    const packet = (type, run, failure) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            const { ws, message, clientInfo } = ctx;
            if (!isAdmin(clientInfo)) {
                handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }
            // sendMessage spreads its fields onto the packet. A failure is the program's own message box,
            // so it comes back in the reply: an error packet would raise the Mainframe exception dialog.
            let data;
            try {
                data = await run(message);
            } catch (error) {
                data = { error: { message: failure, details: error.message, code: error.code || '' } };
            }
            handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
        }, { owner: 'paypass' });
    };

    packet('paypass_info', async () => paypass.info(), 'Failed to read PayPass');
    packet('paypass_overview', async () => paypass.overview(), 'Failed to reach the PayPass server');
    packet('paypass_customer', async (d) => paypass.customer({ id: d.id, card: d.card }), 'Failed to read the customer');
    packet('paypass_action', async (d) => {
        const { type, requestId, ...fields } = d; // eslint-disable-line no-unused-vars
        return paypass.action(fields);
    }, 'The PayPass server did not accept the request');
    packet('paypass_wait', async (d) => paypass.wait({ pos: d.pos, lookup: !!d.lookup }), 'Failed to wait for the card');
}

module.exports = { registerPackets };
