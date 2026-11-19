'use strict';

// Claude plan usage of every Claude account (modules/claudeUsage.js) for the Account Manager tray
// (walletTray.js) and Melaton Mobile's Accounts (wmAccounts.js). Pushed, never polled
// (server-push-not-polling): statusHub feed `claude_usage`, items keyed by account id, plus `_meta`
// { at }. status_subscribe { feed: 'claude_usage' } while the tray / app is seen; admins only.
// The feed reads every 5 minutes while someone watches; any other read (wallet_status Refresh,
// a login finishing) pushes at once through claudeUsage.onRead.

const statusHub = require('../statusHub');
const claudeUsage = require('../../claudeUsage');

const isAdmin = (clientInfo) => !!(clientInfo && clientInfo.userType === 'admin');
let feed = null;
let gResources = null;

function items(snap) {
    const out = { _meta: { at: (snap && snap.at) || null, error: (snap && snap.error) || null } };
    ((snap && snap.accounts) || []).forEach((row) => { out[row.id] = row; });
    return out;
}

function defineFeed() {
    if (feed) return feed;
    feed = statusHub.define({
        name: 'claude_usage',
        pushType: 'claude_usage_status',
        intervalMs: 5 * 60 * 1000,
        allow: isAdmin,
        sample: async () => items(gResources ? await claudeUsage.read(gResources) : null)
    });
    // a read someone else asked for (cache hit inside sample): push it now
    claudeUsage.onRead(() => { if (feed) feed.poke(); });
    return feed;
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    gResources = handlersCtx.globalResources;
    defineFeed();
}

module.exports = { registerPackets, _items: items, _defineFeed: defineFeed };
