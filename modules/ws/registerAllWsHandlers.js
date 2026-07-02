/**
 * Auto-register server WebSocket packet handlers from modules/ws/handlers/.
 *
 * Convention: one handler file per domain, numeric prefix for load order
 * (e.g. 10-vfsHandler.js, 20-configEditorHandler.js). Sorted by numeric prefix.
 * Each module must export registerPackets(handlersCtx). Files without that export log a warning.
 * Duplicate packet types are warned by wsPacketRegistry.registerWsPacket.
 */

const fs = require('fs');
const path = require('path');

const HANDLERS_DIR = path.join(__dirname, 'handlers');

function handlerSortKey(filename) {
    const match = /^(\d+)-/.exec(filename);
    return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Shared impl modules (e.g. chatImpl.js) — required by handlers, not auto-registered. */
function shouldSkipHandlerFile(filename) {
    return /Impl\.js$/.test(filename);
}

function registerAllWsHandlers(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[registerAllWsHandlers] missing handlersCtx');
        return;
    }

    let files;
    try {
        files = fs.readdirSync(HANDLERS_DIR)
            .filter((name) => name.endsWith('.js'))
            .sort((a, b) => {
                const orderA = handlerSortKey(a);
                const orderB = handlerSortKey(b);
                if (orderA !== orderB) return orderA - orderB;
                return a.localeCompare(b);
            });
    } catch (err) {
        console.warn('[registerAllWsHandlers] failed to read handlers dir:', err.message);
        return;
    }

    for (const file of files) {
        if (shouldSkipHandlerFile(file)) {
            continue;
        }

        const fullPath = path.join(HANDLERS_DIR, file);
        let mod;
        try {
            mod = require(fullPath);
        } catch (err) {
            console.warn('[registerAllWsHandlers] failed to require', file + ':', err.message);
            continue;
        }

        if (typeof mod.registerPackets === 'function') {
            mod.registerPackets(handlersCtx);
        } else {
            console.warn('[registerAllWsHandlers]', file, 'missing registerPackets export');
        }
    }
}

module.exports = registerAllWsHandlers;
