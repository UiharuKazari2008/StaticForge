const wsPacketRegistry = require('../wsPacketRegistry');
const textMessaging = require('../../textMessaging');

/**
 * Text Messaging accounts (Yozora #779, modules/textMessaging.js, docs/client-api/ws/textMessaging.md).
 * Administrators only: these are the owner's own iMessage / RCS conversations.
 *
 *   tm_accounts                        { accounts, settings }  (unread counts when known)
 *   tm_summary                         { accounts } with fresh unread counts
 *   tm_account_test  { kind, url, password, id? }        { identity, features, serverVersion }
 *   tm_account_save  { id?, kind, url, password?, enabled }   { account }
 *   tm_account_delete { id }
 *   tm_settings_save { notifyUnknown }
 *   tm_chats    { accountId, folder: inbox|unknown|all, limit, offset }   { chats, more }
 *   tm_chat     { accountId, chatGuid }                                   { chat }
 *   tm_messages { accountId, chatGuid, limit, before }                    { messages, more }
 *   tm_send     { accountId, chatGuid | addresses[], text, replyTo, subject, effect, tempGuid }
 *   tm_react    { accountId, chatGuid, messageGuid, messageText, reaction, remove }
 *   tm_edit     { accountId, messageGuid, text }
 *   tm_unsend   { accountId, messageGuid }
 *   tm_read     { accountId, chatGuid }
 *   tm_typing   { accountId, chatGuid, typing }
 *   tm_resolve  { accountId, address }                                    { name }
 *   tm_rcs_pair_google { accountId } -> { emoji }  (sign-in from Alchemy; tap the emoji on the phone)
 *   tm_rcs_pair { accountId } -> { qr }   tm_rcs_refresh_qr { accountId }   tm_rcs_unpair { accountId }
 *               (RCS accounts: pairing events arrive as tm_event { event: 'pairing', qr | paired })
 *
 * Events: tm_event (see textMessaging.js). Attachments: modules/textMessagingHttp.js.
 * A refusal is an answer { success:false, code, error }, never an error packet.
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[304-textMessagingHandler] registerPackets: missing handlersCtx');
        return;
    }
    try { textMessaging.init(handlersCtx.globalResources); } catch (error) { console.warn('[textMessaging] init failed:', error.message); }
    // the phone's notifications while the app is in the background (modules/textMessagingPhone.js)
    try { require('../../textMessagingPhone').init(handlersCtx.globalResources); } catch (error) { console.warn('[textMessaging] phone init failed:', error.message); }

    const body = (message) => (message.data && typeof message.data === 'object' ? message.data : message);
    const reg = (type, fn, meta = {}) => wsPacketRegistry.registerWsPacket(type, async ({ ws, message, clientInfo }) => {
        const reply = (data) => handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
        if (!(clientInfo && clientInfo.authenticated && clientInfo.userType === 'admin')) {
            reply({ success: false, code: 'INSUFFICIENT_PERMISSIONS', error: 'Admin access required' });
            return;
        }
        try {
            const out = await fn(body(message));
            reply(Object.assign({ success: true }, out));
        } catch (error) {
            reply({ success: false, code: error.code || 'ERROR', error: error.message });
        }
    }, { owner: 'textMessaging', ...meta });

    reg('tm_accounts', async () => textMessaging.listAccounts());
    reg('tm_summary', async () => ({ accounts: await textMessaging.summary() }));
    reg('tm_account_test', async (d) => textMessaging.testAccount(d));
    reg('tm_account_save', async (d) => ({ account: textMessaging.saveAccount(d) }), { destructive: true });
    reg('tm_account_delete', async (d) => textMessaging.deleteAccount(String(d.id || '')), { destructive: true });
    reg('tm_settings_save', async (d) => ({ settings: textMessaging.saveSettings(d) }));
    reg('tm_chats', async (d) => textMessaging.listChats(d.accountId, { folder: d.folder, limit: d.limit, offset: d.offset }));
    reg('tm_chat', async (d) => ({ chat: await textMessaging.getChat(d.accountId, String(d.chatGuid || '')) }));
    reg('tm_messages', async (d) => textMessaging.listMessages(d.accountId, String(d.chatGuid || ''), { limit: Math.min(Number(d.limit) || 50, 200), before: d.before || null }));
    reg('tm_send', async (d) => textMessaging.send(d.accountId, {
        chatGuid: d.chatGuid || null, addresses: Array.isArray(d.addresses) ? d.addresses : null,
        text: String(d.text || ''), replyTo: d.replyTo || null, subject: d.subject || '', effect: d.effect || null, tempGuid: d.tempGuid || null
    }));
    reg('tm_react', async (d) => textMessaging.react(d.accountId, d));
    reg('tm_edit', async (d) => textMessaging.edit(d.accountId, d));
    reg('tm_unsend', async (d) => textMessaging.unsend(d.accountId, d), { destructive: true });
    reg('tm_read', async (d) => textMessaging.markRead(d.accountId, d));
    reg('tm_typing', async (d) => textMessaging.typing(d.accountId, d));
    // RCS (Google Messages pairing): a QR code for the phone, re-pair, end the pairing
    reg('tm_rcs_pair', async (d) => textMessaging.pair(String(d.accountId || '')));
    // Google account pairing: the sign-in comes from Alchemy (the owner signed in at messages.google.com there)
    reg('tm_rcs_pair_google', async (d) => textMessaging.pairGoogle(String(d.accountId || '')), { destructive: true });
    reg('tm_rcs_refresh_qr', async (d) => textMessaging.refreshQr(String(d.accountId || '')));
    reg('tm_rcs_unpair', async (d) => textMessaging.unpair(String(d.accountId || '')), { destructive: true });
    reg('tm_resolve', async (d) => ({ name: await textMessaging.resolveName(d.accountId, String(d.address || '')) }));
}

module.exports = { registerPackets };
