'use strict';

/**
 * Claude Accounts (phone, wmClaudeAccounts.js) and the Claude Remote Control on this host. Admin only,
 * as Security Center's Cursor accounts (190-adminHandler get/switch_cursor_account). The accounts are
 * CardSpace's Claude service keys: adding, renaming and deleting one stays add_api_key /
 * update_api_key / delete_api_key (service 'claude'); the switch is the same selection CardSpace's
 * "Use this account" makes (apiKeyManager.applySelectionUpdates), which also reconnects Remote Control
 * (modules/claudeAccountHost.js). Add Account by signing in (a claude.ai link to copy / open in Alchemy and
 * the code it shows back) is claude_account_login (modules/claudeAccountLogin.js): the host's `claude`
 * CLI in an isolated config dir; the result is a CardSpace Claude key + its linked Remote Control login.
 * switch_claude_account / claude_remote_control reconnect take carry: [session ids] (the Host status'
 * sessions): those Remote Control sessions are started again under the new login, the rest end.
 * Sessions tab: get_claude_sessions (every transcript on the host, paged) and claude_session_action
 * (reconnect: resume into Remote Control, no fork, or its link when it is live already; disconnect: end
 * its rc-* tmux session). modules/claudeSessions.js.
 * Own folders (#1154): claude_remote_fleet { action: move | start | stop | reconnect | leave, index,
 * confirmHost, carry } runs an account's own Remote Control on its own config dir
 * (modules/claudeRemoteFleet.js); every snapshot carries fleet (each account's Remote Control), and
 * claude_remote_fleet_status is pushed when an action changes one.
 * docs/client-api/ws/account.md#claude-accounts
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const claudeHost = require('../../claudeAccountHost');
const claudeLogin = require('../../claudeAccountLogin');
const claudeSessions = require('../../claudeSessions');
const fleet = require('../../claudeRemoteFleet');
const runtime = require('../../claudeAccountRuntime');

const ADMIN_DESTRUCTIVE = { destructive: true };

function isAdmin(clientInfo) {
    return !!(clientInfo && clientInfo.userType === 'admin');
}

async function snapshot(gr) {
    const [host, fleetStatus] = await Promise.all([claudeHost.hostStatus(gr), fleet.status(gr)]);
    return { accounts: claudeHost.listAccounts(gr), host, fleet: fleetStatus };
}

function reply(handlersCtx, ws, message, type, data) {
    handlersCtx.sendToClient(ws, { type, requestId: message.requestId, data: Object.assign({ success: true }, data), timestamp: new Date().toISOString() });
}

function guard(type, fn) {
    return async (handlersCtx, ws, message, clientInfo) => {
        if (!isAdmin(clientInfo)) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            const data = await fn(handlersCtx.globalResources, message || {});
            reply(handlersCtx, ws, message, `${type}_response`, data);
        } catch (error) {
            console.warn(`[claudeAccounts] ${type}: ${error.message}`);
            handlersCtx.sendError(ws, error.message, 'CLAUDE_ACCOUNTS_FAILED', message.requestId);
        }
    };
}

const handleGet = guard('get_claude_accounts', (gr) => snapshot(gr));

const carryOf = (message) => (Array.isArray(message.carry) ? message.carry.filter((id) => typeof id === 'string').slice(0, 32) : []);

const handleSwitch = guard('switch_claude_account', async (gr, message) => {
    const index = Number(message.index);
    const carry = carryOf(message);
    const accounts = claudeHost.listAccounts(gr);
    const target = accounts.find((a) => a.index === index);
    if (!target) throw new Error('No such Claude account');
    if (target.active && runtime.isMoved(target.id)) {
        // in its own folder: "on each switch" reconnects its own Remote Control, nothing on the host changes
        fleet.reconnect(gr, index).catch(() => {});
    } else if (target.active) {
        // already the engine's account: the switch still reconnects (Yukimi: "on each switch")
        claudeHost.reconnect(gr, { index, carry, account: { index, name: target.name }, reason: `Reconnecting as ${target.name}` }).catch(() => {});
    } else {
        // CardSpace's own path: engine token file, then claudeAccountHost.onSelectionChanged (which takes the picks)
        claudeHost.setPendingCarry(carry);
        try { await gr.getApiKeyManager().applySelectionUpdates([{ service: 'claude', index }]); } finally { claudeHost.setPendingCarry(null); }
    }
    return snapshot(gr);
});

const handleLink = guard('link_claude_account_login', async (gr, message) => {
    claudeHost.linkHostLogin(gr, message.index);
    return snapshot(gr);
});

const handleUnlink = guard('unlink_claude_account_login', async (gr, message) => {
    const acc = claudeHost.listAccounts(gr).find((a) => a.index === Number(message.index));
    if (acc && runtime.isMoved(acc.id)) throw new Error(`${acc.name} runs in its own folder: Leave Own Folder first (unlinking removes that folder)`);
    claudeHost.unlinkLogin(gr, message.index);
    return snapshot(gr);
});

const handleRemoteControl = guard('claude_remote_control', async (gr, message) => {
    const action = String(message.action || '');
    if (action === 'stop') {
        await claudeHost.stop(gr);
    } else if (action === 'reconnect' || action === 'start') {
        const active = claudeHost.listAccounts(gr).find((a) => a.active);
        claudeHost.reconnect(gr, {
            index: active ? active.index : undefined,
            carry: carryOf(message),
            account: active ? { index: active.index, name: active.name } : null,
            reason: action === 'start' ? 'Starting Remote Control' : 'Reconnecting Remote Control'
        }).catch(() => {});
    } else {
        throw new Error('action must be reconnect, start or stop');
    }
    return snapshot(gr);
});

const handleFleet = guard('claude_remote_fleet', async (gr, message) => {
    const action = String(message.action || '');
    const index = Number(message.index);
    let result = null;
    if (action === 'move') {
        // answers at once; the move goes on (its state is pushed), the host's account's move ends this socket's server sessions
        const p = fleet.moveToOwnFolder(gr, index, { confirmHost: message.confirmHost === true, carry: carryOf(message) });
        // a refusal (no login, host account unconfirmed) comes back at once; the move itself goes on
        const early = await Promise.race([p.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(null), 50))]);
        if (early instanceof Error) throw early;
        result = { started: true };
    } else if (action === 'start' || action === 'reconnect') {
        const p = fleet[action](gr, index);
        const early = await Promise.race([p.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(null), 50))]);
        if (early instanceof Error) throw early;
        result = { started: true };
    } else if (action === 'stop') {
        result = await fleet.stop(gr, index);
    } else if (action === 'leave') {
        result = await fleet.leaveOwnFolder(gr, index);
    } else if (action !== 'status') {
        throw new Error('action must be status, move, start, stop, reconnect or leave');
    }
    return { result, fleet: await fleet.status(gr) };
});

// #1154: an account's name, preferred flag, usage caps and session defaults (modules/claudeFleetSettings.js)
const handleFleetAccount = guard('claude_fleet_account', async (gr, message) => {
    if (String(message.action || 'save') !== 'save') throw new Error('action must be save');
    const patch = {};
    ['name', 'preferred', 'priority', 'renewalDay', 'maxWeeklyPct', 'maxSessionPct', 'defaultModel', 'defaultEffort', 'defaultMode'].forEach((k) => { if (message[k] !== undefined) patch[k] = message[k]; });
    await require('../../claudeFleetSettings').save(gr, message.index, patch);
    fleet.broadcast();
    return { fleet: await fleet.status(gr) };
});

// Add Account by signing in. Never logs the code: the guard logs error messages only, which carry none.
const handleLogin = guard('claude_account_login', async (gr, message) => {
    const action = String(message.action || 'status');
    let login;
    if (action === 'start') login = claudeLogin.start(gr, { name: message.name, account: message.account, restart: message.restart === true });
    else if (action === 'code') login = claudeLogin.submitCode(gr, message.code, { name: message.name });
    else if (action === 'retry') login = claudeLogin.retry(gr);
    else if (action === 'name') login = claudeLogin.setName(gr, message.name);
    else if (action === 'cancel') login = claudeLogin.cancel(gr);
    else if (action === 'status') login = claudeLogin.status(gr);
    else throw new Error('action must be start, code, retry, name, cancel or status');
    return { login, accounts: claudeHost.listAccounts(gr) };
});

const handleSessions = guard('get_claude_sessions', async (gr, message) => claudeSessions.listAll({ offset: message.offset, limit: message.limit }));

const handleSessionAction = guard('claude_session_action', async (gr, message) => {
    const action = String(message.action || '');
    const id = String(message.id || '');
    let result;
    if (action === 'reconnect') {
        const unit = (await claudeHost.hostStatus(gr)).remoteControl;
        result = await claudeSessions.resume(id, { mode: claudeHost.carryMode(unit) });
    } else if (action === 'disconnect') {
        result = await claudeSessions.disconnect(id);
    } else {
        throw new Error('action must be reconnect or disconnect');
    }
    const list = await claudeSessions.listAll({ offset: message.offset, limit: message.limit });
    return Object.assign({ result }, list);
});

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    // CardSpace's "Use this account" reconnects Remote Control from here on (apiKeyManager -> onSelectionChanged)
    if (!require('../../replicaMode').off('supervisor')) { // replica: no Claude account hosts / remote fleet
        claudeHost.arm(handlersCtx.globalResources);
        fleet.armAll(handlersCtx.globalResources).catch(() => {});
    }
    const reg = (type, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'claudeAccounts', ...meta });
    };
    reg('get_claude_accounts', handleGet);
    reg('switch_claude_account', handleSwitch, ADMIN_DESTRUCTIVE);
    reg('link_claude_account_login', handleLink, ADMIN_DESTRUCTIVE);
    reg('unlink_claude_account_login', handleUnlink, ADMIN_DESTRUCTIVE);
    reg('claude_remote_control', handleRemoteControl, ADMIN_DESTRUCTIVE);
    reg('claude_account_login', handleLogin, ADMIN_DESTRUCTIVE);
    reg('claude_remote_fleet', handleFleet, ADMIN_DESTRUCTIVE);
    reg('claude_fleet_account', handleFleetAccount, ADMIN_DESTRUCTIVE);
    reg('get_claude_sessions', handleSessions);
    reg('claude_session_action', handleSessionAction, ADMIN_DESTRUCTIVE);
}

module.exports = { registerPackets, _handlers: { handleGet, handleSwitch, handleLink, handleUnlink, handleRemoteControl, handleLogin, handleFleet, handleSessions, handleSessionAction } };
