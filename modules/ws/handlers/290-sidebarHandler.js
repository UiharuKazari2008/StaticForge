const wsPacketRegistry = require('../wsPacketRegistry');
const sidebarGadgets = require('../../sidebarGadgets');
const searchHandler = require('./70-searchHandler');
const sidebarSystemInfo = require('../../sidebarSystemInfo');

// Windows Sidebar gadgets (modules/sidebarGadgets.js, client public/scripts/comp/vistaSidebar.js).
// Administrators only: the state carries Notes text and the Mail gadget reads Yukimi's inbox.

function requireAdmin(handlersCtx, ws, message, clientInfo) {
    if (clientInfo && clientInfo.userType === 'admin') return true;
    handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
    return false;
}

function resolveWorkspaceId(handlersCtx, message, clientInfo) {
    const manager = handlersCtx.globalResources.getWorkspaceManager();
    const id = message.workspaceId ? String(message.workspaceId) : manager.getActiveWorkspace(clientInfo.sessionId);
    return manager.getWorkspace(id) ? id : null;
}

function reply(handlersCtx, ws, message, data) {
    handlersCtx.sendToClient(ws, {
        type: `${message.type}_response`,
        requestId: message.requestId,
        data,
        timestamp: new Date().toISOString()
    });
}

async function handleGet(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        const workspaceId = resolveWorkspaceId(handlersCtx, message, clientInfo);
        if (!workspaceId) {
            handlersCtx.sendError(ws, 'Workspace not found', 'WORKSPACE_NOT_FOUND', message.requestId);
            return;
        }
        const stored = handlersCtx.globalResources.getWorkspaceManager().getWorkspace(workspaceId).sidebar;
        const sidebar = sidebarGadgets.sanitizeSidebarState(stored || {});
        reply(handlersCtx, ws, message, { workspaceId, sidebar, saved: !!stored });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to load the Sidebar', error.message, message.requestId);
    }
}

async function handleSave(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        const workspaceId = resolveWorkspaceId(handlersCtx, message, clientInfo);
        if (!workspaceId) {
            handlersCtx.sendError(ws, 'Workspace not found', 'WORKSPACE_NOT_FOUND', message.requestId);
            return;
        }
        const sidebar = sidebarGadgets.sanitizeSidebarState(message.sidebar);
        handlersCtx.globalResources.modifyConfig('workspaces').assign([workspaceId, 'sidebar'], sidebar);
        reply(handlersCtx, ws, message, { success: true, workspaceId, sidebar });
        if (wsServer && typeof wsServer.broadcast === 'function') {
            wsServer.broadcast(
                { type: 'sidebar_updated', data: { workspaceId, sidebar }, timestamp: new Date().toISOString() },
                (info) => info && info !== clientInfo && info.userType === 'admin'
            );
        }
    } catch (error) {
        if (error instanceof sidebarGadgets.SidebarStateError) {
            handlersCtx.sendError(ws, error.message, 'INVALID_SIDEBAR_STATE', message.requestId);
            return;
        }
        handlersCtx.sendError(ws, 'Failed to save the Sidebar', error.message, message.requestId);
    }
}

async function handleRandomImage(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        const workspaceId = resolveWorkspaceId(handlersCtx, message, clientInfo);
        const metadataDb = handlersCtx.globalResources.getMetadataDatabase();
        if (!workspaceId || !metadataDb) {
            reply(handlersCtx, ws, message, { workspaceId, total: 0, index: -1, item: null });
            return;
        }
        const offset = Number.isInteger(message.offset) ? message.offset : null;
        const search = sidebarGadgets.sanitizeFrameSearch(message.search);
        const picked = search
            ? await sidebarGadgets.pickSearchImage(metadataDb, search, offset,
                (query) => searchHandler.omegasearchMatchFilenames(handlersCtx, clientInfo.sessionId, query))
            : await sidebarGadgets.pickWorkspaceImage(metadataDb, workspaceId, message.source, offset);
        reply(handlersCtx, ws, message, { workspaceId, ...picked });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to pick a picture', error.message, message.requestId);
    }
}

async function handleWeather(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        reply(handlersCtx, ws, message, await sidebarGadgets.getClientWeather(handlersCtx.globalResources, clientInfo.clientIP));
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to load the weather', error.message, message.requestId);
    }
}

async function handleHostMetrics(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        reply(handlersCtx, ws, message, sidebarGadgets.getHostLoad());
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to read the host load', error.message, message.requestId);
    }
}

/** Hosted gadgets' machine (Yozora #629): the server's cores, memory, disks, network and processes. */
async function handleSystemInfo(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        reply(handlersCtx, ws, message, await sidebarSystemInfo.getSystemInfo());
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to read the system', error.message, message.requestId);
    }
}

async function handleFx(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        reply(handlersCtx, ws, message, await sidebarGadgets.getFxRate(message.from, message.to));
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to load the exchange rate', error.message, message.requestId);
    }
}

async function handleQuotes(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        reply(handlersCtx, ws, message, await sidebarGadgets.getQuotes(message.symbols));
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to load quotes', error.message, message.requestId);
    }
}

async function handleFeed(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        reply(handlersCtx, ws, message, await sidebarGadgets.getFeed(message.url));
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to load the feed', error.message, message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[290-sidebarHandler] registerPackets: missing handlersCtx');
        return;
    }
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'sidebar', ...meta });
    };
    reg('sidebar_get', handleGet);
    reg('sidebar_save', handleSave, { destructive: true });
    reg('sidebar_random_image', handleRandomImage);
    reg('sidebar_weather', handleWeather);
    reg('sidebar_host_metrics', handleHostMetrics);
    reg('sidebar_system_info', handleSystemInfo);
    reg('sidebar_fx', handleFx);
    reg('sidebar_quotes', handleQuotes);
    reg('sidebar_feed', handleFeed);
}

module.exports = {
    registerPackets
};
