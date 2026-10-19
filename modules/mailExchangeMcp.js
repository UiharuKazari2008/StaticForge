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
        name: 'exchange_create_mailbox',
        core: true,
        role: 'exchange',
        scope: SCOPE,
        description: 'Exchange admin only. Create a mailbox mapped to name.dept@dream.737.jp.net. Never an external domain. Requires confirm:true.',
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
        description: 'Exchange admin only. Get or set external inbound/outbound toggles (global, per mailbox, per service e.g. Yozora). Writes require confirm:true and also PUT the LANTIS relay with the admin token (actor included).',
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

async function handleExchangeTool(req, name, input = {}) {
    const actor = resolveMcpActor(req);
    let admin;
    try {
        admin = exchange.requireExchangeAdmin(actor, name, input && (input.owner || input.localPart || input.id));
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
        if (name === 'exchange_create_mailbox') {
            return mcpTextResult({
                success: true,
                mailbox: exchange.publicMailboxView(exchange.createMailbox(admin, input))
            });
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
