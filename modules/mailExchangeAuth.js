/**
 * Resolve the Exchange admin actor from WS, HTTP, or MCP identity.
 * Admins: Yukimi, Sala, Tsubame (mailroom). Never trust a client-supplied owner.
 */

'use strict';

const { resolveOwnerFromActor } = require('./dovecoteMail');
const {
    isExchangeAdmin,
    canonicalizeAdmin,
    HUMAN_OWNER
} = require('./mailExchange');

function actorFromApplicationAuth(applicationAuth) {
    if (!applicationAuth) return null;
    const name = applicationAuth.appName || applicationAuth.applicationName;
    if (!name) return null;
    try {
        const { resolveDovecoteOwnerFromReq } = require('./dovecoteIdentity');
        const owner = resolveDovecoteOwnerFromReq({ applicationAuth });
        if (owner) return canonicalizeAdmin(owner);
    } catch (_err) {
        /* fall through */
    }
    return canonicalizeAdmin(resolveOwnerFromActor(name));
}

function resolveWsActor(clientInfo) {
    if (!clientInfo) return null;
    const fromKey = actorFromApplicationAuth(clientInfo.applicationAuth || {
        appName: clientInfo.appName,
        applicationKeyId: clientInfo.applicationKeyId
    });
    if (fromKey && isExchangeAdmin(fromKey)) return fromKey;
    if (clientInfo.userType === 'admin') return HUMAN_OWNER;
    return fromKey;
}

function resolveHttpActor(req) {
    if (!req) return null;
    const fromKey = actorFromApplicationAuth(req.applicationAuth);
    if (fromKey && isExchangeAdmin(fromKey)) return fromKey;
    if (req.userType === 'admin') return HUMAN_OWNER;
    return fromKey;
}

function resolveMcpActor(req) {
    try {
        const { resolveDovecoteOwnerFromReq } = require('./dovecoteIdentity');
        const owner = resolveDovecoteOwnerFromReq(req);
        if (owner) return canonicalizeAdmin(owner);
    } catch (_err) {
        /* fall through */
    }
    const fromKey = actorFromApplicationAuth(req && req.applicationAuth);
    if (fromKey) return fromKey;
    if (req && req.userType === 'admin') return HUMAN_OWNER;
    return null;
}

module.exports = {
    actorFromApplicationAuth,
    resolveWsActor,
    resolveHttpActor,
    resolveMcpActor
};
