/**
 * MCP tool defs + dispatch for Dreamscape Exchange Server.
 * Listed only for Yukimi / Sala / Tsubame (mailroom). Scope sfapp_mail_exchange.
 */

'use strict';

const exchange = require('./mailExchange');
const { resolveMcpActor } = require('./mailExchangeAuth');

const SCOPE = 'sfapp_mail_exchange';

const TOOLS = [
    {
        name: 'exchange_list_mailboxes',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only (Yukimi, Sala, Tsubame). List mailboxes and public addresses. Yukimi is kazari.ops@dream.737.jp.net.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    },
    {
        name: 'exchange_get_mailbox',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Get one mailbox, its public address, and extra intake aliases. Tsubame (mailroom) is the intended operator.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner'],
            properties: {
                owner: { type: 'string' }
            }
        }
    },
    {
        name: 'exchange_create_mailbox',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Create a mailbox mapped to name.dept@dream.737.jp.net. Never an external domain. Live immediately, no restart. Requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'dept', 'confirm'],
            properties: {
                owner: { type: 'string' },
                dept: { type: 'string' },
                displayName: { type: 'string' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_update_mailbox',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Update display name, dept, or owner of a mailbox. Live immediately. Requires confirm:true. Mailroom kind stays on Tsubame.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'confirm'],
            properties: {
                owner: { type: 'string' },
                displayName: { type: 'string' },
                dept: { type: 'string' },
                newOwner: { type: 'string' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_disable_mailbox',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Enable or disable a mailbox. Requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'confirm'],
            properties: {
                owner: { type: 'string' },
                enabled: { type: 'boolean' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_delete_mailbox',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Soft-delete a mailbox. Requires confirm:true and confirmText DELETE. Cannot delete Yukimi.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'confirm', 'confirmText'],
            properties: {
                owner: { type: 'string' },
                confirm: { type: 'boolean' },
                confirmText: { type: 'string' }
            }
        }
    },
    {
        name: 'exchange_mailbox_key',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Issue, rotate, or revoke a mailbox key. The secret is shown once and only a hash is stored. Never logged. Requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'action', 'confirm'],
            properties: {
                owner: { type: 'string' },
                action: { type: 'string', enum: ['issue', 'rotate', 'revoke'] },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_add_address',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Add an intake local-part alias on dream.737.jp.net for an existing mailbox. Never an external domain. Live immediately. Requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'localPart', 'confirm'],
            properties: {
                owner: { type: 'string' },
                localPart: { type: 'string' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_remove_address',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Remove a non-primary intake alias. Requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['localPart', 'confirm'],
            properties: {
                localPart: { type: 'string' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_aliases',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. List, upsert, or delete aliases and distribution lists. Loops are rejected. mailroom.ops is the catch-all to Tsubame. Requires confirm:true on writes.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                action: { type: 'string', enum: ['list', 'upsert_alias', 'delete_alias', 'upsert_list', 'delete_list'] },
                localPart: { type: 'string' },
                target: { type: 'string' },
                name: { type: 'string' },
                members: {
                    oneOf: [
                        { type: 'string' },
                        { type: 'array', items: { type: 'string' } }
                    ]
                },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_signatures',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Get or set a per-mailbox HTML signature (sanitized, auto-appended to outbound). Writes require confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner'],
            properties: {
                owner: { type: 'string' },
                html: { type: 'string' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_toggles',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Get or set external inbound/outbound toggles (global, per mailbox, per service e.g. Yozora). Writes require confirm:true (Dreamscape-side). The LANTIS PUT is PATCH-like (omit = unchanged, null deletes a mailbox/service key) and includes actor only — not confirm. Relay 400s: UNKNOWN_MAILBOX, UNKNOWN_SERVICE, BAD_BODY, ACTOR_REQUIRED.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                inbound: { type: 'boolean' },
                outbound: { type: 'boolean' },
                mailboxes: { type: 'object' },
                services: { type: 'object' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_status',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Status dashboard: intake listener, LANTIS relay (Postfix, queue, filters, OCI senders+DKIM, WireGuard, blocklists, recent rejects). Degrades when the relay is unreachable. Tokens never returned.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    },
    {
        name: 'exchange_resync_recipients',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Replace LANTIS virtual_known with the full set of active mailbox addresses, aliases, and lists (PUT /v1/recipients). Directory changes already push automatically; this is the manual resync. The endpoint is pending approval — 404 fails soft and is logged (RELAY_ENDPOINT_MISSING). Requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['confirm'],
            properties: {
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_set_mailbox_notify_forward',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Set the notify-forward address on any mailbox. External address only (not dream.737.jp.net). Live immediately. Requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'address', 'confirm'],
            properties: {
                owner: { type: 'string' },
                address: { type: 'string' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_get_mailbox_notify_forward',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Read the notify-forward address for any mailbox.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner'],
            properties: {
                owner: { type: 'string' }
            }
        }
    },
    {
        name: 'exchange_clear_mailbox_notify_forward',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Clear the notify-forward address on any mailbox. Requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['owner', 'confirm'],
            properties: {
                owner: { type: 'string' },
                confirm: { type: 'boolean' }
            }
        }
    },
    {
        name: 'exchange_spam',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Spam overview. Tsubame sees all mailboxes; rescue/purge uses the mailroom tools and cannot touch Yukimi. Yukimi\'s mailbox is Spam-only. Rescue/purge requires confirm:true.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                mailbox: { type: 'string' },
                id: { type: 'string' },
                spam: { type: 'boolean' },
                confirm: { type: 'boolean' },
                limit: { type: 'number' }
            }
        }
    }
];

function mcpTextResult(obj, isError) {
    return {
        content: [{ type: 'text', text: JSON.stringify(obj) }],
        isError: isError === true
    };
}

function isExchangeTool(name) {
    return TOOLS.some((tool) => tool.name === name);
}

function applicationKeyHasExchangeScope(req) {
    const auth = req && req.applicationAuth;
    if (!auth || !(auth.appName || auth.applicationName || auth.applicationKeyId || auth.keyId)) {
        return true;
    }
    const scopes = auth.applicationScopes;
    if (!Array.isArray(scopes)) return false;
    return scopes.includes(SCOPE) || scopes.includes('universal');
}

async function handleExchangeTool(req, name, input = {}) {
    const actor = resolveMcpActor(req);
    let admin;
    try {
        admin = exchange.requireExchangeAdmin(actor, name, input && (input.owner || input.localPart || input.id));
        if (!applicationKeyHasExchangeScope(req)) {
            exchange.audit(admin, name, input && (input.owner || input.localPart || input.id) || null, false, 'exchange scope required');
            throw new exchange.MailExchangeError(
                'Application key does not have Exchange admin permission',
                'INSUFFICIENT_SCOPE'
            );
        }
    } catch (err) {
        if (err instanceof exchange.MailExchangeError) {
            return mcpTextResult({ success: false, error: err.message, code: err.code }, true);
        }
        throw err;
    }
    try {
        if (name === 'exchange_list_mailboxes') {
            return mcpTextResult({
                success: true,
                mailboxes: exchange.listMailboxRecords().map(exchange.publicMailboxView)
            });
        }
        if (name === 'exchange_get_mailbox') {
            const mailbox = exchange.publicMailboxView(exchange.getMailboxRecord(input.owner));
            if (!mailbox) {
                throw new exchange.MailExchangeError('Unknown mailbox', 'UNKNOWN_MAILBOX');
            }
            return mcpTextResult({ success: true, mailbox });
        }
        if (name === 'exchange_create_mailbox') {
            return mcpTextResult({
                success: true,
                mailbox: exchange.publicMailboxView(exchange.createMailbox(admin, input))
            });
        }
        if (name === 'exchange_update_mailbox') {
            return mcpTextResult({
                success: true,
                mailbox: exchange.publicMailboxView(exchange.updateMailbox(admin, input))
            });
        }
        if (name === 'exchange_add_address') {
            return mcpTextResult({ success: true, ...exchange.addAddress(admin, input) });
        }
        if (name === 'exchange_remove_address') {
            return mcpTextResult({ success: true, ...exchange.removeAddress(admin, input) });
        }
        if (name === 'exchange_disable_mailbox') {
            return mcpTextResult({
                success: true,
                mailbox: exchange.publicMailboxView(exchange.disableMailbox(admin, input))
            });
        }
        if (name === 'exchange_delete_mailbox') {
            return mcpTextResult({
                success: true,
                mailbox: exchange.publicMailboxView(exchange.deleteMailbox(admin, input))
            });
        }
        if (name === 'exchange_mailbox_key') {
            const action = input.action;
            if (action === 'revoke') return mcpTextResult({ success: true, ...exchange.revokeMailboxKey(admin, input) });
            if (action === 'rotate') return mcpTextResult({ success: true, ...exchange.rotateMailboxKey(admin, input) });
            return mcpTextResult({ success: true, ...exchange.issueMailboxKey(admin, input) });
        }
        if (name === 'exchange_aliases') {
            const action = input.action || 'list';
            if (action === 'upsert_alias') return mcpTextResult({ success: true, ...exchange.upsertAlias(admin, input) });
            if (action === 'delete_alias') return mcpTextResult({ success: true, ...exchange.deleteAlias(admin, input) });
            if (action === 'upsert_list') return mcpTextResult({ success: true, ...exchange.upsertDistributionList(admin, input) });
            if (action === 'delete_list') return mcpTextResult({ success: true, ...exchange.deleteDistributionList(admin, input) });
            return mcpTextResult({
                success: true,
                aliases: exchange.listAliases(),
                lists: exchange.listDistributionLists()
            });
        }
        if (name === 'exchange_signatures') {
            if (Object.prototype.hasOwnProperty.call(input, 'html')) {
                return mcpTextResult({ success: true, ...exchange.setSignature(admin, input) });
            }
            return mcpTextResult({ success: true, ...exchange.getSignature(input.owner) });
        }
        if (name === 'exchange_toggles') {
            if (input.confirm === true || input.inbound != null || input.outbound != null || input.mailboxes || input.services) {
                return mcpTextResult({ success: true, ...await exchange.setToggles(admin, input) });
            }
            return mcpTextResult({ success: true, toggles: exchange.getToggles() });
        }
        if (name === 'exchange_status') {
            const dash = await exchange.dashboard();
            return mcpTextResult({ success: true, ...dash });
        }
        if (name === 'exchange_resync_recipients') {
            return mcpTextResult({ success: true, ...await exchange.resyncRecipients(admin, input) });
        }
        if (name === 'exchange_get_mailbox_notify_forward') {
            return mcpTextResult({
                success: true,
                ...exchange.adminGetMailboxNotifyForward(admin, input)
            });
        }
        if (name === 'exchange_set_mailbox_notify_forward') {
            return mcpTextResult({
                success: true,
                ...exchange.adminSetMailboxNotifyForward(admin, input)
            });
        }
        if (name === 'exchange_clear_mailbox_notify_forward') {
            return mcpTextResult({
                success: true,
                ...exchange.adminClearMailboxNotifyForward(admin, input)
            });
        }
        if (name === 'exchange_spam') {
            if (input.id && input.mailbox) {
                return mcpTextResult({
                    success: true,
                    ...exchange.rescueOrPurgeSpam(admin, input)
                });
            }
            return mcpTextResult({ success: true, ...exchange.listSpamOverview(admin, input) });
        }
        return mcpTextResult({ success: false, error: 'Unknown exchange tool', code: 'UNKNOWN_TOOL' }, true);
    } catch (err) {
        if (err instanceof exchange.MailExchangeError) {
            return mcpTextResult({ success: false, error: err.message, code: err.code }, true);
        }
        throw err;
    }
}

module.exports = {
    SCOPE,
    TOOLS,
    isExchangeTool,
    handleExchangeTool
};
