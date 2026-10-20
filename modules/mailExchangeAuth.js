/**
 * Resolve the Exchange admin actor from WS, HTTP, or MCP identity.
 * Admins: Yukimi, Sala, Tsubame (mailroom). Never trust a client-supplied owner.
 */

'use strict';

const { resolveOwnerFromActor } = require('./dovecoteMail');
const {
    isExchangeAdmin,
    canonicalizeAdmin,
    HUMAN_OWNER,
    requireExchangeAdmin,
    MailExchangeError,
    audit
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

// An application-key caller is identified by its key only. Application keys
// carry userType 'admin' by default, so the human-session fallback below
// must never apply to them (a Menma/"Mailroom"/"Admin" key would become
// Yukimi).
function hasApplicationKey(auth) {
    return !!(auth && (auth.appName || auth.applicationName || auth.applicationKeyId || auth.keyId));
}

function resolveWsActor(clientInfo) {
    if (!clientInfo) return null;
    const keyed = hasApplicationKey(clientInfo.applicationAuth) || !!(clientInfo.appName || clientInfo.applicationKeyId);
    const fromKey = actorFromApplicationAuth(clientInfo.applicationAuth || {
        appName: clientInfo.appName,
        applicationKeyId: clientInfo.applicationKeyId
    });
    if (keyed) return fromKey;
    if (clientInfo.userType === 'admin') return HUMAN_OWNER;
    return fromKey;
}

function resolveHttpActor(req) {
    if (!req) return null;
    const fromKey = actorFromApplicationAuth(req.applicationAuth);
    if (hasApplicationKey(req.applicationAuth)) return fromKey;
    if (req.userType === 'admin') return HUMAN_OWNER;
    return fromKey;
}

const EXCHANGE_SCOPE = 'sfapp_mail_exchange';

function hasExchangeAdminScope(auth) {
    if (!hasApplicationKey(auth)) return true;
    const scopes = auth && auth.applicationScopes;
    if (!Array.isArray(scopes)) return false;
    return scopes.includes(EXCHANGE_SCOPE) || scopes.includes('universal');
}

function requireExchangeAdminScope(actor, action, target, auth) {
    const admin = requireExchangeAdmin(actor, action, target);
    if (hasExchangeAdminScope(auth)) return admin;
    audit(admin, action || 'access', target || null, false, 'exchange scope required');
    throw new MailExchangeError(
        'Application key does not have Exchange admin permission',
        'INSUFFICIENT_SCOPE'
    );
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
    if (req && hasApplicationKey(req.applicationAuth)) return fromKey;
    if (req && req.userType === 'admin') return HUMAN_OWNER;
    return null;
}

module.exports = {
    actorFromApplicationAuth,
    resolveWsActor,
    resolveHttpActor,
    resolveMcpActor,
    hasExchangeAdminScope,
    requireExchangeAdminScope,
    EXCHANGE_SCOPE
};
