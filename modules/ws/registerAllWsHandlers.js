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
const wsPacketRegistry = require('./wsPacketRegistry');
const hotReload = require('../hotReload');

const HANDLERS_DIR = path.join(__dirname, 'handlers');

function handlerSortKey(filename) {
    const match = /^(\d+)-/.exec(filename);
    return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Shared impl modules (e.g. chatImpl.js) — required by handlers, not auto-registered. */
function shouldSkipHandlerFile(filename) {
    return /Impl\.js$/.test(filename);
}

// The ctx registerAllWsHandlers got: a hot-reloaded handler file registers again with it (#1293).
let savedCtx = null;

function isReloadableHandlerFile(abs) {
    const p = path.normalize(String(abs || ''));
    return path.dirname(p) === HANDLERS_DIR && p.endsWith('.js') && !shouldSkipHandlerFile(path.basename(p));
}

/** Drops the file's packet types and registers them again from `exports`; throws when that cannot be done. */
function reregister(abs, exports) {
    if (!exports || typeof exports.registerPackets !== 'function') {
        throw new Error(path.basename(abs) + ' has no registerPackets export');
    }
    if (!savedCtx) throw new Error('registerAllWsHandlers has not run yet');
    wsPacketRegistry.unregisterByFile(abs);
    wsPacketRegistry.withRegistrar(abs, () => exports.registerPackets(savedCtx));
}

hotReload.addLoader({
    name: 'ws-handlers',
    match: isReloadableHandlerFile,
    afterAccept(abs, exports) {
        reregister(abs, exports);
    },
    rollback(abs, exports) {
        reregister(abs, exports);
    }
});

function registerAllWsHandlers(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[registerAllWsHandlers] missing handlersCtx');
        return;
    }
    savedCtx = handlersCtx;

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
            wsPacketRegistry.withRegistrar(fullPath, () => mod.registerPackets(handlersCtx));
        } else {
            console.warn('[registerAllWsHandlers]', file, 'missing registerPackets export');
        }
    }
}

module.exports = registerAllWsHandlers;
