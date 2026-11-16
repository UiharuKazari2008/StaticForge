/**
 * Live package updates (Yozora #872): when an installed system package's tree changes (the notify
 * refresh re-syncs apps/*, or a launch / describe refreshed it), every client is told
 * (app_package_updated { packageId, version, title, treeHash }) and swaps the package if it runs it
 * (public/scripts/comp/melatonApps.js applyPackageUpdate). Server halves on the older tree are
 * retired: idle ones at once, the rest after RETIRE_GRACE_MS, by which time their tabs have ended
 * the instance and launched it again on the new tree.
 */
'use strict';

const RETIRE_GRACE_MS = 20000;

let attached = false;

function reservedPacketTypes() {
    try {
        return require('../ws/wsPacketRegistry').listRegisteredPackets().map((row) => row.type);
    } catch (_) {
        return [];
    }
}

/** Listen for package changes once per server; broadcast(message) sends to every client. */
function attachPackageUpdates({ broadcast, log }) {
    if (attached) return;
    attached = true;
    const { onPackageUpdated, getMelatonApps } = require('./index');
    onPackageUpdated((change) => {
        const say = typeof log === 'function' ? log : console.log;
        say(`[melaton apps] ${change.id} updated (${String(change.previous || '').slice(0, 12)} -> ${change.treeHash.slice(0, 12)}): telling clients`);
        try {
            broadcast({
                type: 'app_package_updated',
                data: { packageId: change.id, version: change.version, title: change.title, treeHash: change.treeHash },
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.error('[melaton apps] update broadcast failed:', err.message);
        }
        const shared = getMelatonApps.peek();
        if (shared) shared.runner.retireStale(change.id, change.treeHash, RETIRE_GRACE_MS);
    });
}

/**
 * The notify refresh: install the system packages whose tree changed (each change is announced by
 * the listener above). Returns the changes.
 */
function syncSystemPackageUpdates(globalResources) {
    const { getMelatonApps, resyncSystemPackages, onPackageUpdated } = require('./index');
    // every change announced during this call (creating the store syncs too, before the resync)
    const seen = [];
    const off = onPackageUpdated((change) => seen.push(change));
    try {
        // the store is created the way the WS handler creates it (packet types it must not take)
        getMelatonApps(globalResources, { getReservedPacketTypes: reservedPacketTypes });
        resyncSystemPackages();
    } finally {
        off();
    }
    return seen;
}

module.exports = { attachPackageUpdates, syncSystemPackageUpdates, RETIRE_GRACE_MS };
