const wsPacketRegistry = require('../wsPacketRegistry');
const prefs = require('../../messagingAccountPrefs');

/**
 * Messaging's account order and account names (Yozora #978, modules/messagingAccountPrefs.js,
 * docs/client-api/ws/textMessaging.md "Account order and names"). Administrators only.
 *
 *   msg_account_prefs_get                         { order, names }
 *   msg_account_prefs_save { order?, names? }      { order, names }   (names: a patch, '' = the account's own name)
 *
 * Push: msg_account_prefs { order, names } to the other admin pages when either changes.
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    const body = (m) => (m.data && typeof m.data === 'object' ? m.data : m);
    const reg = (type, fn, meta = {}) => wsPacketRegistry.registerWsPacket(type, async ({ ws, message, clientInfo }) => {
        const reply = (data) => handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
        if (!(clientInfo && clientInfo.authenticated && clientInfo.userType === 'admin')) { reply({ success: false, code: 'INSUFFICIENT_PERMISSIONS', error: 'Admin access required' }); return; }
        try { reply(Object.assign({ success: true }, await fn(body(message), clientInfo))); } catch (error) { reply({ success: false, code: error.code || 'ERROR', error: error.message }); }
    }, { owner: 'messagingAccountPrefs', ...meta });

    reg('msg_account_prefs_get', async () => prefs.get());
    reg('msg_account_prefs_save', async (d, clientInfo) => prefs.save(d, clientInfo));
}

module.exports = { registerPackets };
