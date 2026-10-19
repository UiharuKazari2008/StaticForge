/**
 * HTTP surface for Dreamscape Exchange Server.
 * Every route is gated to Yukimi, Sala, or Tsubame (mailroom).
 */

'use strict';

const exchange = require('./mailExchange');
const { resolveHttpActor } = require('./mailExchangeAuth');

function sendError(res, err) {
    const status = err.code === 'FORBIDDEN' ? 403
        : err.code === 'DISABLED' ? 503
            : err.code === 'CONFIRM_REQUIRED' ? 400
                : err.code === 'UNKNOWN_MAILBOX' || err.code === 'KEY_NOT_FOUND' ? 404
                    : 400;
    res.status(status).json({ error: err.message, code: err.code || 'EXCHANGE_ERROR' });
}

function requireActor(req, res) {
    const actor = resolveHttpActor(req);
    try {
        return exchange.requireExchangeAdmin(actor, req.method + ' ' + req.path, null);
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
    app.post('/mail-exchange/mailboxes', authMiddleware, json, gated(async (actor, req) => ({
        mailbox: exchange.publicMailboxView(exchange.createMailbox(actor, req.body || {}))
    })));
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
    app.get('/mail-exchange/spam', authMiddleware, gated(async (actor, req) => (
        exchange.listSpamOverview(actor, { limit: req.query.limit })
    )));
    app.post('/mail-exchange/spam/move', authMiddleware, json, gated(async (actor, req) => (
        exchange.rescueOrPurgeSpam(actor, req.body || {})
    )));
    app.get('/mail-exchange/audit', authMiddleware, gated(async (_actor, req) => ({
        audit: exchange.listAudit({ limit: req.query.limit })
    })));
}

module.exports = { registerRoutes };
