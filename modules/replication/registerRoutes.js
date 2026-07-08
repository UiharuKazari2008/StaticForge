/**
 * Auto-register replication HTTP routes from modules/replication/routes/*.js
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, 'routes');

function routeSortKey(filename) {
    const match = /^(\d+)-/.exec(filename);
    return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function registerReplicationRoutes(app, globalResources) {
    if (!app || !globalResources) {
        console.warn('[registerReplicationRoutes] missing app or globalResources');
        return;
    }

    let files;
    try {
        files = fs.readdirSync(ROUTES_DIR)
            .filter((name) => name.endsWith('.js'))
            .sort((a, b) => {
                const orderA = routeSortKey(a);
                const orderB = routeSortKey(b);
                if (orderA !== orderB) return orderA - orderB;
                return a.localeCompare(b);
            });
    } catch (err) {
        console.warn('[registerReplicationRoutes] failed to read routes dir:', err.message);
        return;
    }

    for (const file of files) {
        const fullPath = path.join(ROUTES_DIR, file);
        let mod;
        try {
            mod = require(fullPath);
        } catch (err) {
            console.warn('[registerReplicationRoutes] failed to require', file + ':', err.message);
            continue;
        }

        if (typeof mod.register === 'function') {
            mod.register(app, globalResources);
        } else {
            console.warn('[registerReplicationRoutes]', file, 'missing register export');
        }
    }
}

module.exports = registerReplicationRoutes;
