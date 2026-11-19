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
 * docs/client-api/ws/account.md#claude-accounts
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const claudeHost = require('../../claudeAccountHost');
const claudeLogin = require('../../claudeAccountLogin');

const ADMIN_DESTRUCTIVE = { destructive: true };

function isAdmin(clientInfo) {
    return !!(clientInfo && clientInfo.userType === 'admin');
}

async function snapshot(gr) {
    return { accounts: claudeHost.listAccounts(gr), host: await claudeHost.hostStatus(gr) };
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

const handleSwitch = guard('switch_claude_account', async (gr, message) => {
    const index = Number(message.index);
    const accounts = claudeHost.listAccounts(gr);
    const target = accounts.find((a) => a.index === index);
    if (!target) throw new Error('No such Claude account');
    if (target.active) {
        // already the engine's account: the switch still reconnects (Yukimi: "on each switch")
        claudeHost.reconnect(gr, { index, account: { index, name: target.name }, reason: `Reconnecting as ${target.name}` }).catch(() => {});
    } else {
        // CardSpace's own path: engine token file, then claudeAccountHost.onSelectionChanged
        await gr.getApiKeyManager().applySelectionUpdates([{ service: 'claude', index }]);
    }
    return snapshot(gr);
});

const handleLink = guard('link_claude_account_login', async (gr, message) => {
    claudeHost.linkHostLogin(gr, message.index);
    return snapshot(gr);
});

const handleUnlink = guard('unlink_claude_account_login', async (gr, message) => {
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
            account: active ? { index: active.index, name: active.name } : null,
            reason: action === 'start' ? 'Starting Remote Control' : 'Reconnecting Remote Control'
        }).catch(() => {});
    } else {
        throw new Error('action must be reconnect, start or stop');
    }
    return snapshot(gr);
});

// Add Account by signing in. Never logs the code: the guard logs error messages only, which carry none.
const handleLogin = guard('claude_account_login', async (gr, message) => {
    const action = String(message.action || 'status');
    let login;
    if (action === 'start') login = claudeLogin.start(gr, { name: message.name, restart: message.restart === true });
    else if (action === 'code') login = claudeLogin.submitCode(gr, message.code, { name: message.name });
    else if (action === 'retry') login = claudeLogin.retry(gr);
    else if (action === 'name') login = claudeLogin.setName(gr, message.name);
    else if (action === 'cancel') login = claudeLogin.cancel(gr);
    else if (action === 'status') login = claudeLogin.status(gr);
    else throw new Error('action must be start, code, retry, name, cancel or status');
    return { login, accounts: claudeHost.listAccounts(gr) };
});

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    // CardSpace's "Use this account" reconnects Remote Control from here on (apiKeyManager -> onSelectionChanged)
    claudeHost.arm(handlersCtx.globalResources);
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
}

module.exports = { registerPackets, _handlers: { handleGet, handleSwitch, handleLink, handleUnlink, handleRemoteControl, handleLogin } };
