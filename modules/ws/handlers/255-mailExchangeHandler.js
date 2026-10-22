/**
 * Dreamscape Exchange Server WebSocket packets.
 * Every handler is identity-gated: Yukimi, Sala, or Tsubame (mailroom).
 */

'use strict';

const wsPacketRegistry = require('../wsPacketRegistry');
const exchange = require('../../mailExchange');
const { resolveWsActor, requireExchangeAdminScope } = require('../../mailExchangeAuth');

const DESTRUCTIVE = { destructive: true };

function sendOk(handlersCtx, ws, type, requestId, data) {
    handlersCtx.sendToClient(ws, {
        type: `${type}_response`,
        requestId,
        data,
        timestamp: new Date().toISOString()
    });
}

function requireActor(handlersCtx, ws, message, clientInfo) {
    const actor = resolveWsActor(clientInfo);
    try {
        const auth = clientInfo && (clientInfo.applicationAuth || {
            appName: clientInfo.appName,
            applicationKeyId: clientInfo.applicationKeyId,
            applicationScopes: clientInfo.applicationScopes
        });
        return requireExchangeAdminScope(actor, message.type, null, auth);
    } catch (err) {
        handlersCtx.sendError(ws, err.message, err.code || 'FORBIDDEN', message.requestId);
        return null;
    }
}

function wrap(fn) {
    return async (handlersCtx, ws, message, clientInfo) => {
        const actor = requireActor(handlersCtx, ws, message, clientInfo);
        if (!actor) return;
        try {
            const data = await fn(actor, message);
            sendOk(handlersCtx, ws, message.type, message.requestId, data);
        } catch (err) {
            handlersCtx.sendError(
                ws,
                err.message || 'Exchange request failed',
                err.code || 'EXCHANGE_ERROR',
                message.requestId
            );
        }
    };
}

const handleListMailboxes = wrap(async () => ({
    mailboxes: exchange.listMailboxRecords().map(exchange.publicMailboxView)
}));

const handleGetMailbox = wrap(async (_actor, message) => {
    const mailbox = exchange.publicMailboxView(exchange.getMailboxRecord(message.owner));
    if (!mailbox) throw new exchange.MailExchangeError('Unknown mailbox', 'UNKNOWN_MAILBOX');
    return { mailbox };
});

const handleCreateMailbox = wrap(async (actor, message) => ({
    mailbox: exchange.publicMailboxView(exchange.createMailbox(actor, {
        owner: message.owner,
        dept: message.dept,
        displayName: message.displayName,
        confirm: message.confirm === true
    }))
}));

const handleUpdateMailbox = wrap(async (actor, message) => ({
    mailbox: exchange.publicMailboxView(exchange.updateMailbox(actor, {
        owner: message.owner,
        displayName: message.displayName,
        dept: message.dept,
        newOwner: message.newOwner,
        confirm: message.confirm === true
    }))
}));

const handleAddAddress = wrap(async (actor, message) => (
    exchange.addAddress(actor, {
        owner: message.owner,
        localPart: message.localPart,
        confirm: message.confirm === true
    })
));

const handleRemoveAddress = wrap(async (actor, message) => (
    exchange.removeAddress(actor, {
        localPart: message.localPart,
        confirm: message.confirm === true
    })
));

const handleDisableMailbox = wrap(async (actor, message) => ({
    mailbox: exchange.publicMailboxView(exchange.disableMailbox(actor, {
        owner: message.owner,
        enabled: message.enabled,
        confirm: message.confirm === true
    }))
}));

const handleDeleteMailbox = wrap(async (actor, message) => ({
    mailbox: exchange.publicMailboxView(exchange.deleteMailbox(actor, {
        owner: message.owner,
        confirm: message.confirm === true,
        confirmText: message.confirmText
    }))
}));

const handleIssueKey = wrap(async (actor, message) => (
    exchange.issueMailboxKey(actor, { owner: message.owner, confirm: message.confirm === true })
));

const handleRotateKey = wrap(async (actor, message) => (
    exchange.rotateMailboxKey(actor, { owner: message.owner, confirm: message.confirm === true })
));

const handleRevokeKey = wrap(async (actor, message) => (
    exchange.revokeMailboxKey(actor, { owner: message.owner, confirm: message.confirm === true })
));

const handleListAliases = wrap(async () => ({
    aliases: exchange.listAliases(),
    lists: exchange.listDistributionLists()
}));

const handleUpsertAlias = wrap(async (actor, message) => (
    exchange.upsertAlias(actor, {
        localPart: message.localPart,
        target: message.target,
        confirm: message.confirm === true
    })
));

const handleDeleteAlias = wrap(async (actor, message) => (
    exchange.deleteAlias(actor, { localPart: message.localPart, confirm: message.confirm === true })
));

const handleUpsertList = wrap(async (actor, message) => (
    exchange.upsertDistributionList(actor, {
        localPart: message.localPart,
        name: message.name,
        members: message.members,
        confirm: message.confirm === true
    })
));

const handleDeleteList = wrap(async (actor, message) => (
    exchange.deleteDistributionList(actor, {
        localPart: message.localPart,
        confirm: message.confirm === true
    })
));

const handleGetSignature = wrap(async (_actor, message) => exchange.getSignature(message.owner));

const handleSetSignature = wrap(async (actor, message) => (
    exchange.setSignature(actor, {
        owner: message.owner,
        html: message.html,
        confirm: message.confirm === true
    })
));

const handleGetToggles = wrap(async () => ({ toggles: exchange.getToggles() }));

const handleSetToggles = wrap(async (actor, message) => (
    exchange.setToggles(actor, {
        inbound: message.inbound,
        outbound: message.outbound,
        mailboxes: message.mailboxes,
        services: message.services,
        confirm: message.confirm === true
    })
));

const handleDashboard = wrap(async () => exchange.dashboard());

const handleResyncRecipients = wrap(async (actor, message) => (
    exchange.resyncRecipients(actor, { confirm: message.confirm === true })
));

const handleListSpam = wrap(async (actor, message) => (
    exchange.listSpamOverview(actor, { limit: message.limit })
));

const handleSpamMove = wrap(async (actor, message) => (
    exchange.rescueOrPurgeSpam(actor, {
        mailbox: message.mailbox,
        id: message.id,
        spam: message.spam === true,
        confirm: message.confirm === true
    })
));

const handleAudit = wrap(async (_actor, message) => ({ audit: exchange.listAudit({ limit: message.limit }) }));

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[255-mailExchangeHandler] registerPackets: missing handlersCtx');
        return;
    }
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'mailExchange', ...meta });
    };
    reg('exchange_list_mailboxes', handleListMailboxes);
    reg('exchange_get_mailbox', handleGetMailbox);
    reg('exchange_create_mailbox', handleCreateMailbox, DESTRUCTIVE);
    reg('exchange_update_mailbox', handleUpdateMailbox, DESTRUCTIVE);
    reg('exchange_add_address', handleAddAddress, DESTRUCTIVE);
    reg('exchange_remove_address', handleRemoveAddress, DESTRUCTIVE);
    reg('exchange_disable_mailbox', handleDisableMailbox, DESTRUCTIVE);
    reg('exchange_delete_mailbox', handleDeleteMailbox, DESTRUCTIVE);
    reg('exchange_issue_key', handleIssueKey, DESTRUCTIVE);
    reg('exchange_rotate_key', handleRotateKey, DESTRUCTIVE);
    reg('exchange_revoke_key', handleRevokeKey, DESTRUCTIVE);
    reg('exchange_list_aliases', handleListAliases);
    reg('exchange_upsert_alias', handleUpsertAlias, DESTRUCTIVE);
    reg('exchange_delete_alias', handleDeleteAlias, DESTRUCTIVE);
    reg('exchange_upsert_list', handleUpsertList, DESTRUCTIVE);
    reg('exchange_delete_list', handleDeleteList, DESTRUCTIVE);
    reg('exchange_get_signature', handleGetSignature);
    reg('exchange_set_signature', handleSetSignature, DESTRUCTIVE);
    reg('exchange_get_toggles', handleGetToggles);
    reg('exchange_set_toggles', handleSetToggles, DESTRUCTIVE);
    reg('exchange_dashboard', handleDashboard);
    reg('exchange_resync_recipients', handleResyncRecipients, DESTRUCTIVE);
    reg('exchange_list_spam', handleListSpam);
    reg('exchange_spam_move', handleSpamMove, DESTRUCTIVE);
    reg('exchange_audit', handleAudit);
}

module.exports = {
    registerPackets,
    _test: {
        handleListMailboxes,
        handleCreateMailbox,
        handleDeleteMailbox,
        handleIssueKey,
        handleUpsertAlias,
        handleSetToggles,
        handleDashboard
    }
};
