/**
 * HTTP surface for Dreamscape Exchange Server.
 * Every route is gated to Yukimi, Sala, or Tsubame (mailroom).
 */

'use strict';

const exchange = require('./mailExchange');
const { resolveHttpActor, requireExchangeAdminScope } = require('./mailExchangeAuth');

function sendError(res, err) {
    const status = err.code === 'FORBIDDEN' || err.code === 'INSUFFICIENT_SCOPE' ? 403
        : err.code === 'DISABLED' ? 503
            : err.code === 'CONFIRM_REQUIRED' ? 400
                : err.code === 'UNKNOWN_MAILBOX' || err.code === 'KEY_NOT_FOUND' || err.code === 'UNKNOWN_ADDRESS' ? 404
                    : 400;
    res.status(status).json({ error: err.message, code: err.code || 'EXCHANGE_ERROR' });
}

function requireActor(req, res) {
    const actor = resolveHttpActor(req);
    try {
        return requireExchangeAdminScope(actor, req.method + ' ' + req.path, null, req.applicationAuth);
    } catch (err) {
        sendError(res, err);
        return null;
    }
}

function registerRoutes(app, { authMiddleware }) {
    const json = require('express').json();

    function gated(handler) {
        return async (req, res) => {
            const actor = requireActor(req, res);
            if (!actor) return;
            try {
                const data = await handler(actor, req);
                res.json(data);
            } catch (err) {
                sendError(res, err);
            }
        };
    }

    app.get('/mail-exchange/mailboxes', authMiddleware, gated(async () => ({
        mailboxes: exchange.listMailboxRecords().map(exchange.publicMailboxView)
    })));
    app.get('/mail-exchange/mailboxes/:owner', authMiddleware, gated(async (_actor, req) => {
        const mailbox = await exchange.mailboxViewWithRelay(req.params.owner);
        if (!mailbox) throw new exchange.MailExchangeError('Unknown mailbox', 'UNKNOWN_MAILBOX');
        return { mailbox };
    }));
    app.post('/mail-exchange/mailboxes', authMiddleware, json, gated(async (actor, req) => ({
        mailbox: exchange.publicMailboxView(exchange.createMailbox(actor, req.body || {}))
    })));
    app.patch('/mail-exchange/mailboxes/:owner', authMiddleware, json, gated(async (actor, req) => ({
        mailbox: exchange.publicMailboxView(exchange.updateMailbox(actor, Object.assign({ owner: req.params.owner }, req.body || {})))
    })));
    app.post('/mail-exchange/mailboxes/:owner/addresses', authMiddleware, json, gated(async (actor, req) => (
        exchange.addAddress(actor, Object.assign({ owner: req.params.owner }, req.body || {}))
    )));
    app.delete('/mail-exchange/addresses/:localPart', authMiddleware, json, gated(async (actor, req) => (
        exchange.removeAddress(actor, Object.assign({ localPart: req.params.localPart }, req.body || {}))
    )));
    app.post('/mail-exchange/mailboxes/:owner/disable', authMiddleware, json, gated(async (actor, req) => ({
        mailbox: exchange.publicMailboxView(exchange.disableMailbox(actor, Object.assign({ owner: req.params.owner }, req.body || {})))
    })));
    app.delete('/mail-exchange/mailboxes/:owner', authMiddleware, json, gated(async (actor, req) => ({
        mailbox: exchange.publicMailboxView(exchange.deleteMailbox(actor, Object.assign({ owner: req.params.owner }, req.body || {})))
    })));
    app.post('/mail-exchange/mailboxes/:owner/keys', authMiddleware, json, gated(async (actor, req) => (
        exchange.issueMailboxKey(actor, Object.assign({ owner: req.params.owner }, req.body || {}))
    )));
    app.post('/mail-exchange/mailboxes/:owner/keys/rotate', authMiddleware, json, gated(async (actor, req) => (
        exchange.rotateMailboxKey(actor, Object.assign({ owner: req.params.owner }, req.body || {}))
    )));
    app.post('/mail-exchange/mailboxes/:owner/keys/revoke', authMiddleware, json, gated(async (actor, req) => (
        exchange.revokeMailboxKey(actor, Object.assign({ owner: req.params.owner }, req.body || {}))
    )));
    app.get('/mail-exchange/aliases', authMiddleware, gated(async () => ({
        aliases: exchange.listAliases(),
        lists: exchange.listDistributionLists()
    })));
    app.put('/mail-exchange/aliases', authMiddleware, json, gated(async (actor, req) => (
        exchange.upsertAlias(actor, req.body || {})
    )));
    app.delete('/mail-exchange/aliases/:localPart', authMiddleware, json, gated(async (actor, req) => (
        exchange.deleteAlias(actor, Object.assign({ localPart: req.params.localPart }, req.body || {}))
    )));
    app.put('/mail-exchange/lists', authMiddleware, json, gated(async (actor, req) => (
        exchange.upsertDistributionList(actor, req.body || {})
    )));
    app.delete('/mail-exchange/lists/:localPart', authMiddleware, json, gated(async (actor, req) => (
        exchange.deleteDistributionList(actor, Object.assign({ localPart: req.params.localPart }, req.body || {}))
    )));
    app.get('/mail-exchange/signatures/:owner', authMiddleware, gated(async (_actor, req) => (
        exchange.getSignature(req.params.owner)
    )));
    app.put('/mail-exchange/signatures/:owner', authMiddleware, json, gated(async (actor, req) => (
        exchange.setSignature(actor, Object.assign({ owner: req.params.owner }, req.body || {}))
    )));
    app.get('/mail-exchange/toggles', authMiddleware, gated(async () => ({
        toggles: exchange.getToggles()
    })));
    app.put('/mail-exchange/toggles', authMiddleware, json, gated(async (actor, req) => (
        exchange.setToggles(actor, req.body || {})
    )));
    app.get('/mail-exchange/status', authMiddleware, gated(async () => exchange.dashboard()));
    app.post('/mail-exchange/recipients/resync', authMiddleware, json, gated(async (actor, req) => (
        exchange.resyncRecipients(actor, req.body || {})
    )));
    app.get('/mail-exchange/spam', authMiddleware, gated(async (actor, req) => (
        exchange.listSpamOverview(actor, { limit: req.query.limit })
    )));
    app.post('/mail-exchange/spam/move', authMiddleware, json, gated(async (actor, req) => (
        exchange.rescueOrPurgeSpam(actor, req.body || {})
    )));
    app.get('/mail-exchange/audit', authMiddleware, gated(async (_actor, req) => ({
        audit: exchange.listAudit({ limit: req.query.limit })
    })));
    app.get('/mail-exchange/mailboxes/:owner/notify-forward', authMiddleware, gated(async (actor, req) => (
        exchange.adminGetMailboxNotifyForward(actor, { owner: req.params.owner })
    )));
    app.put('/mail-exchange/mailboxes/:owner/notify-forward', authMiddleware, json, gated(async (actor, req) => (
        exchange.adminSetMailboxNotifyForward(actor, Object.assign({ owner: req.params.owner }, req.body || {}))
    )));
    app.delete('/mail-exchange/mailboxes/:owner/notify-forward', authMiddleware, json, gated(async (actor, req) => (
        exchange.adminClearMailboxNotifyForward(actor, Object.assign({ owner: req.params.owner }, req.body || {}))
    )));
}

module.exports = { registerRoutes };
