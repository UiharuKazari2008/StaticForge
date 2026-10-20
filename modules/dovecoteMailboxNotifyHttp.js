/**
 * HTTP surface for a key holder to register its own mailbox notify-forward
 * address. Owner is resolved from the application key. The body cannot
 * choose another mailbox.
 */

'use strict';

const { resolveDovecoteOwnerFromReq } = require('./dovecoteIdentity');
const {
    setMailboxNotifyForward,
    getMailboxNotifyForward,
    clearMailboxNotifyForward,
    hasMailboxNotifyScope
} = require('./dovecoteMailboxNotify');

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
    if (!hasMailboxNotifyScope(scopes)) {
        throw new DovecoteError('Application key does not have Dovecote notify permission', 'INSUFFICIENT_SCOPE');
    }
    return owner;
}

async function handleMailboxNotifyHttp(req) {
    const owner = requireOwnMailbox(req);
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET') return { status: 200, body: getMailboxNotifyForward(owner) };
    if (method === 'DELETE') return { status: 200, body: clearMailboxNotifyForward(owner) };
    if (method === 'PUT' || method === 'POST') {
        const body = req.body || {};
        return { status: 200, body: setMailboxNotifyForward(owner, { address: body.address }) };
    }
    const { DovecoteError } = require('./dovecoteMail');
    throw new DovecoteError('Method not allowed', 'METHOD_NOT_ALLOWED');
}

function registerRoutes(app, { authMiddleware }) {
    const json = require('express').json();

    function gated(req, res) {
        handleMailboxNotifyHttp(req).then((result) => {
            res.status(result.status).json(result.body);
        }).catch((err) => sendError(res, err));
    }

    app.get('/dovecote/mailbox/notify-forward', authMiddleware, gated);
    app.put('/dovecote/mailbox/notify-forward', authMiddleware, json, gated);
    app.post('/dovecote/mailbox/notify-forward', authMiddleware, json, gated);
    app.delete('/dovecote/mailbox/notify-forward', authMiddleware, gated);
}

module.exports = {
    registerRoutes,
    handleMailboxNotifyHttp,
    requireOwnMailbox
};
