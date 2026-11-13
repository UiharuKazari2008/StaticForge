const wsPacketRegistry = require('../wsPacketRegistry');
const mailAccounts = require('../../mailAccounts');

/**
 * IMAP e-mail accounts (Yozora #789, modules/mailAccounts.js). Administrators only.
 *
 *   ma_accounts                                   { accounts, presets }
 *   ma_account_test  { email, displayName, imap, smtp, password, smtpPassword?, id? }
 *   ma_account_save  { id?, email, displayName, imap, smtp, password?, smtpPassword?, enabled, settings }
 *   ma_account_delete { id }
 *   ma_folders   { accountId }                    { folders: [{ path, name, special, total, unseen, synced }] }
 *   ma_messages  { accountId, folder, limit, before, unseenOnly }   { messages, more, cursor }
 *   ma_message   { accountId, folder, uid, markSeen }               { message (html sanitized, attachments with url) }
 *   ma_flags     { accountId, folder, uids, add, remove }
 *   ma_move      { accountId, folder, uids, to }
 *   ma_delete    { accountId, folder, uids }      (into Trash; for good in Trash)
 *   ma_send      { accountId, to, cc, bcc, subject, text, html, attachments: [uploadId], reply: { folder, uid, kind } }
 *   ma_save_draft { accountId, to, cc, bcc, subject, text, html, attachments, forwardFrom?, replaceUid? } -> { folder, uid }
 *   (ma_send also takes forwardFrom: { folder, uid, parts? } and draftUid)
 *   ma_search    { q, accountId?, limit }         { results }
 *   ma_sync_status / ma_resync { accountId, rebuild }
 * Events: ma_event. Attachments: GET /api/mailaccounts/:id/attachment?folder&uid&part; uploads: POST /api/mailaccounts/upload?name=
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    try { mailAccounts.init(handlersCtx.globalResources); } catch (error) { console.warn('[mailAccounts] init failed:', error.message); }
    const body = (m) => (m.data && typeof m.data === 'object' ? m.data : m);
    const reg = (type, fn, meta = {}) => wsPacketRegistry.registerWsPacket(type, async ({ ws, message, clientInfo }) => {
        const reply = (data) => handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
        if (!(clientInfo && clientInfo.authenticated && clientInfo.userType === 'admin')) { reply({ success: false, code: 'INSUFFICIENT_PERMISSIONS', error: 'Admin access required' }); return; }
        try { reply(Object.assign({ success: true }, await fn(body(message)))); } catch (error) { reply({ success: false, code: error.code || 'ERROR', error: error.message }); }
    }, { owner: 'mailAccounts', ...meta });

    reg('ma_accounts', async () => mailAccounts.listAccounts());
    reg('ma_account_test', async (d) => mailAccounts.testAccount(d));
    reg('ma_account_save', async (d) => ({ account: mailAccounts.saveAccount(d) }), { destructive: true });
    reg('ma_account_delete', async (d) => mailAccounts.deleteAccount(String(d.id || '')), { destructive: true });
    reg('ma_folders', async (d) => mailAccounts.listFolders(d.accountId));
    reg('ma_messages', async (d) => mailAccounts.listMessages(d.accountId, String(d.folder || 'INBOX'), { limit: d.limit, before: d.before || null, unseenOnly: d.unseenOnly === true }));
    reg('ma_message', async (d) => mailAccounts.getMessage(d.accountId, String(d.folder || 'INBOX'), d.uid, { markSeen: d.markSeen !== false }));
    reg('ma_flags', async (d) => mailAccounts.setFlags(d.accountId, String(d.folder || 'INBOX'), d.uids, { add: d.add || [], remove: d.remove || [] }));
    reg('ma_move', async (d) => mailAccounts.move(d.accountId, String(d.folder || 'INBOX'), d.uids, String(d.to || '')));
    reg('ma_delete', async (d) => mailAccounts.remove(d.accountId, String(d.folder || 'INBOX'), d.uids), { destructive: true });
    reg('ma_send', async (d) => mailAccounts.send(d.accountId, d));
    reg('ma_save_draft', async (d) => mailAccounts.saveDraft(d.accountId, d));
    reg('ma_search', async (d) => mailAccounts.search(d.q, { accountId: d.accountId || null, limit: d.limit }));
    reg('ma_sync_status', async () => mailAccounts.syncStatus());
    reg('ma_resync', async (d) => mailAccounts.resync(String(d.accountId || ''), { rebuild: d.rebuild === true }), { destructive: true });
}

module.exports = { registerPackets };
