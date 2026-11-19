'use strict';

/**
 * Ingest Controller console (Server Manager > Roles > Ingest Controller; public/scripts/comp/mmcIngest.js).
 * Signed-in administrators only. Every packet is the MCP tool of the same name and runs through the same
 * code: messagingBridgeMcp.runBridgeTool (its dispatch, its confirms, its audit), so nothing here decides
 * anything the MCP tools do not. Contract: docs/client-api/ingest-controller.md (WebSocket).
 *
 *   ingest_list_accounts, ingest_list_modules, ingest_dry_run, ingest_log, ingest_expiry_status,
 *   bridge_mail_list_rules                                                     reads
 *   ingest_set_mode, ingest_configure_module, ingest_expiry_sweep,
 *   bridge_mail_save_rule, bridge_mail_delete_rule, bridge_mail_run_rules     writes (destructive list;
 *                                                                             confirm:true where the tool wants it)
 *   -> <type>_response { data: { success: true, ...the tool's result } | { success: false, error, code } }
 *      (code = the tool's: CONFIRM_REQUIRED, NOT_FOUND, BAD_SETTINGS ...; INSUFFICIENT_PERMISSIONS for a non-administrator)
 *
 * Feed `ingest_controller` (statusHub, push type ingest_controller_status) while the console shows a node of
 * the snap-in: items `a:<source>|<accountId>` (the account's ingest_list_accounts row), `log` (the newest 8
 * ingest_log entries), `rules` (the mail rules), `x:<source>|<accountId>` (expiry counts + last sweep, for
 * accounts in process mode with expiry on). Pushed when the store or the rules change (an MCP call, a
 * console write, mail arriving); the 10-minute read only catches accounts added elsewhere.
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const statusHub = require('../statusHub');

const SCOPE = 'sfapp_messaging_bridge';
const READS = ['ingest_list_accounts', 'ingest_list_modules', 'ingest_dry_run', 'ingest_log', 'ingest_expiry_status', 'bridge_mail_list_rules'];
const WRITES = ['ingest_set_mode', 'ingest_configure_module', 'ingest_expiry_sweep', 'bridge_mail_save_rule', 'bridge_mail_delete_rule', 'bridge_mail_run_rules'];
const PACKETS = READS.concat(WRITES);
// the fields each packet passes on (anything else is dropped before the tool sees it)
const FIELDS = {
    ingest_list_accounts: ['source'],
    ingest_set_mode: ['source', 'accountId', 'mode', 'applying', 'confirm'],
    ingest_list_modules: ['source', 'accountId', 'probe'],
    ingest_configure_module: ['source', 'accountId', 'module', 'enabled', 'settings', 'position', 'reset', 'confirm'],
    ingest_dry_run: ['source', 'accountId', 'ref', 'message', 'allModules', 'scoreSpam'],
    ingest_log: ['source', 'accountId', 'limit', 'before'],
    ingest_expiry_status: ['source', 'accountId', 'limit'],
    ingest_expiry_sweep: ['source', 'accountId', 'dryRun', 'confirm'],
    bridge_mail_list_rules: ['accountId'],
    bridge_mail_save_rule: ['id', 'accountId', 'name', 'enabled', 'position', 'match', 'actions'],
    bridge_mail_delete_rule: ['id', 'confirm'],
    bridge_mail_run_rules: ['accountId', 'folder', 'limit', 'ruleId', 'dryRun', 'confirm']
};

let bridgeMod = null;
let ctlMod = null;
const bridge = () => bridgeMod || require('../../messagingBridgeMcp');
const ctl = () => ctlMod || require('../../ingestController');

const keyed = (info) => !!info && (info.authMethod === 'application_key' || info.authMethod === 'trusted_keyless' || !!info.applicationKeyId);

/** A signed-in administrator; an application key must also name the bridge scope (as on MCP). */
function allowed(info) {
    if (!info || info.authenticated === false) return false;
    if (info.userType !== 'admin' && info.userType !== 'dev_admin') return false;
    if (keyed(info)) {
        const scopes = (info.applicationAuth && info.applicationAuth.applicationScopes) || info.applicationScopes;
        return Array.isArray(scopes) && scopes.includes(SCOPE);
    }
    return true;
}

/** Who the audit names: the Exchange owner for the administrator's own desktop, else the key's app. */
function actorOf(info) {
    try {
        const a = require('../../mailExchangeAuth').resolveWsActor(info);
        if (a) return String(a);
    } catch (_) { /* below */ }
    return String((info && (info.appName || info.username)) || 'administrator');
}

function pick(type, message) {
    const out = {};
    for (const k of FIELDS[type] || []) if (message[k] !== undefined) out[k] = message[k];
    return out;
}

// ---- the feed ------------------------------------------------------------------------------------

async function sample() {
    const items = {};
    const c = ctl();
    let accounts = [];
    try { accounts = c.listAccounts({}).accounts || []; } catch (_) { accounts = []; }
    for (const a of accounts) {
        items[`a:${a.source}|${a.accountId}`] = a;
        const expiryOn = a.mode === 'process' && (a.source === 'email' || a.source === 'exchange') && (a.pipeline || []).some((p) => p.id === 'expiry' && p.enabled);
        if (!expiryOn) continue;
        try {
            const x = c.expiryStatus({ source: a.source, accountId: a.accountId, limit: 1 });
            items[`x:${a.source}|${a.accountId}`] = { counts: x.counts, lastSweep: x.lastSweep, sweepEveryMinutes: x.sweepEveryMinutes };
        } catch (_) { /* the account went away */ }
    }
    try { items.log = (c.recentLog({ limit: 8 }).entries || []); } catch (_) { items.log = []; }
    try { items.rules = (require('../../mailAccountsRules').listRules({}).rules || []); } catch (_) { items.rules = []; }
    return items;
}

const feed = statusHub.define({
    name: 'ingest_controller',
    pushType: 'ingest_controller_status',
    intervalMs: 10 * 60 * 1000,
    allow: allowed,
    sample
});

// writes from anywhere (MCP, this console, mail arriving) push; a burst (a sweep logging 200 rows) is one read
let pokeTimer = null;
function pokeSoon() {
    if (!feed.size || pokeTimer) return;
    pokeTimer = setTimeout(() => { pokeTimer = null; feed.poke(); }, 400);
    if (pokeTimer.unref) pokeTimer.unref();
}
let hooked = false;
function hookChanges() {
    if (hooked) return;
    hooked = true;
    try { require('../../ingestStore').onChange(pokeSoon); } catch (_) { /* store missing */ }
    try { bridge().onRulesChange(pokeSoon); } catch (_) { /* bridge missing */ }
}

// ---- packets -----------------------------------------------------------------------------------------

// refusals come back as the response ({ success: false, error, code }), not as an error packet: the desktop
// shows an error packet as an unhandled exception, and CONFIRM_REQUIRED is the console's cue to ask
async function handle(handlersCtx, ctx) {
    const { ws, message, clientInfo } = ctx;
    const type = message.type;
    const reply = (data) => handlersCtx.sendToClient(ws, { type: `${type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
    if (!allowed(clientInfo)) {
        reply({ success: false, error: 'Only an administrator can use the Ingest Controller.', code: 'INSUFFICIENT_PERMISSIONS' });
        return;
    }
    try {
        const out = await bridge().runBridgeTool(type, pick(type, message), actorOf(clientInfo));
        reply(Object.assign({ success: true }, out));
    } catch (err) {
        reply({ success: false, error: (err && err.message) || 'The Ingest Controller request failed.', code: (err && err.code) || 'INGEST_ERROR' });
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[314-ingestControllerHandler] registerPackets: missing handlersCtx');
        return;
    }
    hookChanges();
    for (const type of PACKETS) {
        wsPacketRegistry.registerWsPacket(type, (ctx) => handle(handlersCtx, ctx), { owner: 'ingestController', destructive: WRITES.includes(type) });
    }
}

module.exports = {
    registerPackets,
    READS,
    WRITES,
    _test: {
        allowed,
        sample,
        handle,
        feed,
        setModules: ({ bridge: b, controller } = {}) => { bridgeMod = b || null; ctlMod = controller || null; }
    }
};
