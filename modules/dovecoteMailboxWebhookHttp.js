/**
 * HTTP surface for a key holder to register its own mailbox webhook.
 * Owner is resolved from the application key. The body cannot choose
 * another mailbox.
 */

'use strict';

const { resolveDovecoteOwnerFromReq } = require('./dovecoteIdentity');
const {
    setMailboxWebhook,
    getMailboxWebhook,
    clearMailboxWebhook,
    hasMailboxWebhookScope
} = require('./dovecoteMailboxWebhook');

function sendError(res, err) {
    const status = err.code === 'FORBIDDEN' || err.code === 'INSUFFICIENT_SCOPE' ? 403
        : err.code === 'UNKNOWN_OWNER' ? 404
            : 400;
    res.status(status).json({ error: err.message, code: err.code || 'DOVECOTE_ERROR' });
}

function requireOwnMailbox(req) {
    const { DovecoteError } = require('./dovecoteMail');
    const owner = resolveDovecoteOwnerFromReq(req);
    if (!owner) {
        throw new DovecoteError('Caller identity does not map to a Dovecote mailbox', 'FORBIDDEN');
    }
    const scopes = req && req.applicationAuth && req.applicationAuth.applicationScopes;
    if (!hasMailboxWebhookScope(scopes)) {
        throw new DovecoteError('Application key does not have Dovecote webhook permission', 'INSUFFICIENT_SCOPE');
    }
    return owner;
}

async function handleMailboxWebhookHttp(req) {
    const owner = requireOwnMailbox(req);
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET') return { status: 200, body: getMailboxWebhook(owner) };
    if (method === 'DELETE') return { status: 200, body: clearMailboxWebhook(owner) };
    if (method === 'PUT' || method === 'POST') {
        const body = req.body || {};
        return { status: 200, body: await setMailboxWebhook(owner, { url: body.url, authHeader: body.authHeader }) };
    }
    const { DovecoteError } = require('./dovecoteMail');
    throw new DovecoteError('Method not allowed', 'METHOD_NOT_ALLOWED');
}

function registerRoutes(app, { authMiddleware }) {
    const json = require('express').json();

    function gated(req, res) {
        handleMailboxWebhookHttp(req).then((result) => {
            res.status(result.status).json(result.body);
        }).catch((err) => sendError(res, err));
    }

    app.get('/dovecote/mailbox/webhook', authMiddleware, gated);
    app.put('/dovecote/mailbox/webhook', authMiddleware, json, gated);
    app.post('/dovecote/mailbox/webhook', authMiddleware, json, gated);
    app.delete('/dovecote/mailbox/webhook', authMiddleware, gated);
}

module.exports = {
    registerRoutes,
    handleMailboxWebhookHttp,
    requireOwnMailbox
};
