/**
 * Messaging Bridge MCP module (scope sfapp_messaging_bridge): Yukimi's own external mail
 * (IMAP accounts, iCloud included: modules/mailAccounts.js), her mail rules
 * (modules/mailAccountsRules.js) and her text messages (BlueBubbles / iMessage, RCS, Android:
 * modules/textMessaging.js), for Tsubame (mailroom), who cleans the inboxes and keeps the rules.
 * Yukimi asked for it on Nov 18 2026.
 *
 * The tools call the same functions the admin-only ma_* / tm_* WebSocket packets call
 * (305-mailAccountsHandler.js, 304-textMessagingHandler.js); the packets stay admin-only.
 * Two gates, both required:
 *   - the application key carries sfapp_messaging_bridge by name ('universal' does not count);
 *   - the key resolves to Tsubame (or Yukimi). Every other identity is refused even with the scope.
 * Writes that send or delete need confirm:true. Every call is audit-logged to the Exchange audit
 * (actor, tool, target, ok/failed; never bodies or secrets) and to MCP activity by the facade.
 * Account credentials (add / edit / delete an account) are not exposed here.
 * Ingest Controller tools (ingest_*; modules/ingestMcp.js) ride on the same scope: switching an account to process mode,
 * enabling applying, or enabling a module that deletes / forwards needs confirm:true.
 */

'use strict';

const SCOPE = 'sfapp_messaging_bridge';
const ROLE = 'messaging_bridge';
const BRIDGE_OWNERS = Object.freeze(['tsubame', 'yukimi']);

let backends = null;
function mailAccounts() { return (backends && backends.mailAccounts) || require('./mailAccounts'); }
function mailRules() { return (backends && backends.mailRules) || require('./mailAccountsRules'); }
function textMessaging() { return (backends && backends.textMessaging) || require('./textMessaging'); }

const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const uids = { type: 'array', items: { type: 'number' }, description: 'IMAP UIDs in that folder' };
const addrList = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };

function tool(name, description, properties, required) {
    return {
        name,
        core: true,
        role: ROLE,
        scope: SCOPE,
        description: `Messaging Bridge (Tsubame, Yukimi's own accounts). ${description}`,
        inputSchema: { type: 'object', additionalProperties: false, required: required || [], properties: properties || {} }
    };
}

const TOOLS = [
    // ---- IMAP mail (iCloud, Gmail, Outlook.com ...) ----
    tool('bridge_mail_accounts', 'List Yukimi\'s external e-mail accounts (iCloud and other IMAP): id, address, status, unread, sync. No passwords.', {}),
    tool('bridge_mail_folders', 'Folders of one e-mail account with total / unread counts and special use (Inbox, Sent, Junk, Trash, Archive).', { accountId: str }, ['accountId']),
    tool('bridge_mail_messages', 'List messages in a folder, newest first (summaries). Page with before = the last cursor.', {
        accountId: str, folder: { type: 'string', description: 'Default INBOX' }, limit: num, before: { type: ['string', 'number'] }, unseenOnly: bool
    }, ['accountId']),
    tool('bridge_mail_message', 'Read one message (text, sanitized HTML, attachments list). markSeen defaults to false here, so reading does not mark it read.', {
        accountId: str, folder: str, uid: num, markSeen: bool
    }, ['accountId', 'uid']),
    tool('bridge_mail_search', 'Full-text search over the synced copy of every account (or one): subject, sender, recipients, body.', { q: str, accountId: str, limit: num }, ['q']),
    tool('bridge_mail_flags', 'Add / remove IMAP flags on messages, e.g. add ["\\\\Seen"] to mark read, remove ["\\\\Seen"] for unread, ["\\\\Flagged"] to flag.', {
        accountId: str, folder: str, uids, add: { type: 'array', items: str }, remove: { type: 'array', items: str }
    }, ['accountId', 'uids']),
    tool('bridge_mail_move', 'Move messages to another folder (folder path from bridge_mail_folders).', { accountId: str, folder: str, uids, to: str }, ['accountId', 'uids', 'to']),
    tool('bridge_mail_delete', 'Delete messages: into Trash; when already in Trash, for good. Requires confirm:true.', { accountId: str, folder: str, uids, confirm: bool }, ['accountId', 'uids', 'confirm']),
    tool('bridge_mail_send', 'Send mail from one of Yukimi\'s accounts over its SMTP. reply { folder, uid, kind: reply|forward } threads it; forwardFrom { folder, uid, parts? } brings the original\'s attachments; draftUid sends a saved draft. Requires confirm:true.', {
        accountId: str, to: addrList, cc: addrList, bcc: addrList, subject: str, text: str, html: str,
        reply: { type: 'object' }, forwardFrom: { type: 'object' }, draftUid: num, confirm: bool
    }, ['accountId', 'confirm']),
    tool('bridge_mail_save_draft', 'Save a draft into the account\'s Drafts folder (nothing is sent). replaceUid replaces an older draft.', {
        accountId: str, to: addrList, cc: addrList, bcc: addrList, subject: str, text: str, html: str, forwardFrom: { type: 'object' }, replaceUid: num
    }, ['accountId']),
    tool('bridge_mail_sync_status', 'Sync state of every account (running, last sync, push) and storage.', {}),
    tool('bridge_mail_resync', 'Sync an account again now; rebuild:true drops the copy and pulls it again.', { accountId: str, rebuild: bool }, ['accountId']),
    // ---- mail rules ----
    tool('bridge_mail_list_rules', 'List mail rules (all, or the ones that cover accountId). Rules run on each account\'s Inbox as new mail syncs in; first match wins.', { accountId: str }),
    tool('bridge_mail_save_rule', 'Create (no id) or update (id) a mail rule. match: { from?, to?, subject? } (case-insensitive contains; all given must match). actions: { markRead?, flag?, moveTo?, delete? } (moveTo or delete, not both; delete goes to Trash). accountId "*" (default) = every account. New rules only touch mail that arrives after; use bridge_mail_run_rules for mail already there.', {
        id: str, accountId: str, name: str, enabled: bool, position: num,
        match: { type: 'object', properties: { from: str, to: str, subject: str } },
        actions: { type: 'object', properties: { markRead: bool, flag: bool, moveTo: str, delete: bool } }
    }),
    tool('bridge_mail_delete_rule', 'Delete a mail rule. Requires confirm:true.', { id: str, confirm: bool }, ['id', 'confirm']),
    tool('bridge_mail_run_rules', 'Run the rules over mail already in a folder (default INBOX, newest first, up to limit). dryRun defaults to true and only reports matches; dryRun:false applies them and requires confirm:true.', {
        accountId: str, folder: str, limit: num, ruleId: str, dryRun: bool, confirm: bool
    }, ['accountId']),
    // ---- text messages (iMessage via BlueBubbles, RCS, Android apps) ----
    tool('bridge_text_accounts', 'List text messaging accounts (Apple iMessage via BlueBubbles, RCS, Android app notifications): id, status, unread.', {}),
    tool('bridge_text_chats', 'List conversations. folder: inbox (known senders), unknown (Unknown Senders) or all.', {
        accountId: str, folder: { type: 'string', enum: ['inbox', 'unknown', 'all'] }, limit: num, offset: num
    }, ['accountId']),
    tool('bridge_text_chat', 'One conversation: title, participants, unread.', { accountId: str, chatGuid: str }, ['accountId', 'chatGuid']),
    tool('bridge_text_messages', 'Messages in a conversation, oldest first within the page. before pages back.', { accountId: str, chatGuid: str, limit: num, before: { type: ['string', 'number'] } }, ['accountId', 'chatGuid']),
    tool('bridge_text_search', 'Search message text in every connected account (or one).', { q: str, accountId: str, limit: num }, ['q']),
    tool('bridge_text_mark_read', 'Mark a conversation read.', { accountId: str, chatGuid: str }, ['accountId', 'chatGuid']),
    tool('bridge_text_mark_unread', 'Mark a conversation unread.', { accountId: str, chatGuid: str }, ['accountId', 'chatGuid']),
    tool('bridge_text_send', 'Send a text as Yukimi into a conversation (chatGuid) or to addresses (new conversation). Requires confirm:true.', {
        accountId: str, chatGuid: str, addresses: { type: 'array', items: str }, text: str, subject: str, replyTo: str, confirm: bool
    }, ['accountId', 'text', 'confirm']),
    tool('bridge_text_delete_chat', 'Delete a conversation on the Mac / phone. Requires confirm:true.', { accountId: str, chatGuid: str, confirm: bool }, ['accountId', 'chatGuid', 'confirm'])
];

// Ingest Controller (modules/ingestController.js): per-account bypass / process pipeline over bridge mail,
// texts and DS Exchange mailboxes. Same scope, same gates, same audit.
const ingestMcp = require('./ingestMcp');
ingestMcp.buildTools(SCOPE, ROLE).forEach((t) => TOOLS.push(t));

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

function mcpTextResult(obj, isError) {
    return { content: [{ type: 'text', text: JSON.stringify(obj) }], isError: isError === true };
}

function isBridgeTool(name) { return TOOL_NAMES.has(name); }

function bridgeError(message, code) { return Object.assign(new Error(message), { code }); }

/** Canonical bridge owner ('tsubame' | 'yukimi') or null. mailroom is Tsubame. */
function bridgeOwner(actor) {
    const v = String(actor || '').trim().toLowerCase();
    if (v === 'mailroom') return 'tsubame';
    return BRIDGE_OWNERS.includes(v) ? v : null;
}

function isBridgeOwner(actor) { return !!bridgeOwner(actor); }

/** The key's scopes name sfapp_messaging_bridge itself ('universal' alone is not enough). */
function scopesHaveBridge(scopes) { return Array.isArray(scopes) && scopes.includes(SCOPE); }

function resolveActor(req) {
    try { return require('./mailExchangeAuth').resolveMcpActor(req); } catch (_) { return null; }
}

function requestScopes(req) {
    const auth = req && req.applicationAuth;
    if (auth && Array.isArray(auth.applicationScopes)) return auth.applicationScopes;
    try { return require('./agentClientBridge').resolveAgentAuthScopes(req); } catch (_) { return []; }
}

function audit(actor, action, target, success, detail) {
    try { require('./mailExchange').audit(actor || 'unknown', action, target || null, success, detail || null); } catch (_) { /* audit store not ready */ }
}

function targetOf(input) {
    const parts = [input.source, input.accountId, input.folder, input.chatGuid, input.id || input.ruleId, input.module, input.mode];
    if (Array.isArray(input.uids)) parts.push(`uids:${input.uids.length}`);
    return parts.filter((x) => x != null && x !== '').join('|') || null;
}

function needConfirm(input, what) {
    if (input.confirm !== true) throw bridgeError(`${what} needs confirm:true`, 'CONFIRM_REQUIRED');
}

function list(v) { return Array.isArray(v) ? v.map(Number).filter((u) => u > 0) : []; }

async function dispatch(name, input, actor) {
    const ma = () => mailAccounts();
    const folder = String(input.folder || 'INBOX');
    switch (name) {
        case 'bridge_mail_accounts': return { accounts: ma().listAccounts().accounts };
        case 'bridge_mail_folders': return ma().listFolders(String(input.accountId || ''));
        case 'bridge_mail_messages': return ma().listMessages(String(input.accountId || ''), folder, { limit: input.limit, before: input.before || null, unseenOnly: input.unseenOnly === true });
        case 'bridge_mail_message': return ma().getMessage(String(input.accountId || ''), folder, input.uid, { markSeen: input.markSeen === true });
        case 'bridge_mail_search': return ma().search(String(input.q || ''), { accountId: input.accountId || null, limit: input.limit });
        case 'bridge_mail_flags': {
            const flags = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 10) : []);
            const add = flags(input.add);
            const remove = flags(input.remove);
            if (!add.length && !remove.length) throw bridgeError('Give add or remove flags', 'NO_FLAGS');
            return Object.assign({ uids: list(input.uids).length }, await ma().setFlags(String(input.accountId || ''), folder, list(input.uids), { add, remove }));
        }
        case 'bridge_mail_move': {
            if (!input.to) throw bridgeError('to (folder path) is required', 'NO_FOLDER');
            return Object.assign({ moved: list(input.uids).length, to: String(input.to) }, await ma().move(String(input.accountId || ''), folder, list(input.uids), String(input.to)));
        }
        case 'bridge_mail_delete': {
            needConfirm(input, 'Delete');
            return Object.assign({ deleted: list(input.uids).length }, await ma().remove(String(input.accountId || ''), folder, list(input.uids)));
        }
        case 'bridge_mail_send': {
            needConfirm(input, 'Send');
            const body = { to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.text, html: input.html, reply: input.reply || null, forwardFrom: input.forwardFrom || null, draftUid: input.draftUid || null };
            return Object.assign({ sent: true }, await ma().send(String(input.accountId || ''), body));
        }
        case 'bridge_mail_save_draft': {
            const body = { to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, text: input.text, html: input.html, forwardFrom: input.forwardFrom || null, replaceUid: input.replaceUid || null };
            return ma().saveDraft(String(input.accountId || ''), body);
        }
        case 'bridge_mail_sync_status': return ma().syncStatus();
        case 'bridge_mail_resync': return ma().resync(String(input.accountId || ''), { rebuild: input.rebuild === true });
        case 'bridge_mail_list_rules': return mailRules().listRules({ accountId: input.accountId || null });
        case 'bridge_mail_save_rule': return mailRules().saveRule(input);
        case 'bridge_mail_delete_rule': needConfirm(input, 'Deleting a rule'); return mailRules().deleteRule(String(input.id || ''));
        case 'bridge_mail_run_rules': {
            const dryRun = input.dryRun !== false;
            if (!dryRun) needConfirm(input, 'Applying rules');
            return mailRules().runRules({ accountId: input.accountId, folder, limit: input.limit, ruleId: input.ruleId || null, dryRun });
        }
        case 'bridge_text_accounts': return { accounts: textMessaging().listAccounts().accounts };
        case 'bridge_text_chats': return textMessaging().listChats(String(input.accountId || ''), { folder: input.folder || 'all', limit: input.limit, offset: input.offset });
        case 'bridge_text_chat': return { chat: await textMessaging().getChat(String(input.accountId || ''), String(input.chatGuid || '')) };
        case 'bridge_text_messages': return textMessaging().listMessages(String(input.accountId || ''), String(input.chatGuid || ''), { limit: Math.min(Number(input.limit) || 50, 200), before: input.before || null });
        case 'bridge_text_search': return textMessaging().search(String(input.q || ''), { accountId: input.accountId || null, limit: Math.min(Number(input.limit) || 40, 200) });
        case 'bridge_text_mark_read': return Object.assign({ ok: true }, await textMessaging().markRead(String(input.accountId || ''), { chatGuid: String(input.chatGuid || '') }));
        case 'bridge_text_mark_unread': return textMessaging().markUnread(String(input.accountId || ''), { chatGuid: String(input.chatGuid || '') });
        case 'bridge_text_send': {
            needConfirm(input, 'Send');
            const text = String(input.text || '');
            if (!text.trim()) throw bridgeError('text is required', 'NO_TEXT');
            const addresses = Array.isArray(input.addresses) && input.addresses.length ? input.addresses.map(String) : null;
            if (!input.chatGuid && !addresses) throw bridgeError('chatGuid or addresses is required', 'NO_RECIPIENT');
            return Object.assign({ sent: true }, await textMessaging().send(String(input.accountId || ''), {
                chatGuid: input.chatGuid || null, addresses, text, replyTo: input.replyTo || null, subject: input.subject || '', effect: null, tempGuid: null
            }));
        }
        case 'bridge_text_delete_chat': needConfirm(input, 'Deleting a conversation'); return textMessaging().deleteChat(String(input.accountId || ''), { chatGuid: String(input.chatGuid || '') });
        default:
            if (ingestMcp.isIngestTool(name)) return ingestMcp.dispatch(name, input, actor);
            throw bridgeError('Unknown messaging bridge tool', 'UNKNOWN_TOOL');
    }
}

// the tools that change the mail rules: the Ingest Controller console's feed is told (ingest's own writes tell
// it through ingestStore.onChange)
const RULE_WRITES = new Set(['bridge_mail_save_rule', 'bridge_mail_delete_rule', 'bridge_mail_run_rules']);
const changeListeners = new Set();
function onRulesChange(fn) { if (typeof fn === 'function') changeListeners.add(fn); return () => changeListeners.delete(fn); }

/**
 * One tool, already past the gates: the same dispatch and audit for MCP (handleBridgeTool) and the Ingest
 * Controller console's WS packets (modules/ws/handlers/314-ingestControllerHandler.js). Throws the tool's error.
 */
async function runBridgeTool(name, input, actor) {
    const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const target = targetOf(body);
    try {
        const out = await dispatch(name, body, actor);
        audit(actor, name, target, true, null);
        if (RULE_WRITES.has(name)) for (const fn of changeListeners) { try { fn(name); } catch (_) { /* a listener's own problem */ } }
        return out || {};
    } catch (error) {
        audit(actor, name, target, false, error && error.message);
        throw error;
    }
}

async function handleBridgeTool(req, name, args) {
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const actor = resolveActor(req);
    const owner = bridgeOwner(actor);
    const target = targetOf(input);
    if (!owner) {
        audit(actor, name, target, false, 'messaging bridge owner required');
        return mcpTextResult({ success: false, error: 'Messaging Bridge is for Tsubame (mailroom) only', code: 'FORBIDDEN' }, true);
    }
    if (!scopesHaveBridge(requestScopes(req))) {
        audit(owner, name, target, false, 'messaging bridge scope required');
        return mcpTextResult({ success: false, error: `Application key does not have ${SCOPE}`, code: 'INSUFFICIENT_SCOPE' }, true);
    }
    try {
        const out = await runBridgeTool(name, input, owner);
        return mcpTextResult(Object.assign({ success: true }, out));
    } catch (error) {
        return mcpTextResult({ success: false, error: (error && error.message) || 'Failed', code: (error && error.code) || 'ERROR' }, true);
    }
}

module.exports = {
    SCOPE,
    ROLE,
    TOOLS,
    BRIDGE_OWNERS,
    isBridgeTool,
    isBridgeOwner,
    scopesHaveBridge,
    handleBridgeTool,
    runBridgeTool,
    onRulesChange,
    _test: { setBackends: (b) => { backends = b || null; }, dispatch }
};
