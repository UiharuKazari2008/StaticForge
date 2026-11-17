const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const wsPacketRegistry = require('../wsPacketRegistry');
const siteAccess = require('../../siteAccess');
const statusHub = require('../statusHub');
const hardwareSensors = require('../../hardwareSensors');

// Server Manager (Yozora #831 slice 5; public/scripts/comp/mmcServerManager.js): the root page's
// Server Summary, the Hardware and Sensors feed (#896), and Clients (#898): every connected client
// pushed while the page shows, with Resync and Disconnect. Signed-in administrators.
//
//   server_client_action { clientId, action: 'resync' | 'disconnect' } -> { success, clientId, action }
//     resync      the client re-runs a reconnect's resync (workspace, refresh callbacks): client_resync
//     disconnect  the client is told (client_disconnect: it stays off and says an administrator
//                 disconnected it), then its socket is closed
//
//   server_manager_summary -> { host, platform, version, osUptimeSec, processUptimeSec, startedAt,
//                               clients: { sessions, signedIn, desktops, phones, devices },
//                               frontGate: { enabled, cover } }

const isAdmin = (info) => !!info && info.authenticated !== false && (info.userType === 'admin' || info.userType === 'dev_admin');

// Hardware and Sensors (Yozora #896): the hwmon readings, read here every 5 s while the snap-in shows
// and pushed only when a reading changed (statusHub, rule server-push-not-polling). Administrators.
// items: { <sensor id>: row } (modules/hardwareSensors.js), plus '#host'
statusHub.define({
    name: 'hardware_sensors',
    pushType: 'hardware_sensors_status',
    intervalMs: 5000,
    allow: isAdmin,
    async sample() {
        const r = hardwareSensors.read();
        const items = { '#host': r.host };
        for (const row of r.sensors) items[row.id] = row;
        return items;
    }
});

let version = null;
function serverVersion() {
    if (version === null) {
        try { version = String(require(path.join(__dirname, '..', '..', '..', 'package.json')).version || ''); } catch (_) { version = ''; }
    }
    return version;
}

function countClients(wsServer) {
    const out = { sessions: 0, signedIn: 0, desktops: 0, phones: 0, devices: 0 };
    if (!wsServer || !wsServer.clients) return out;
    for (const [ws, info] of wsServer.clients) {
        if (!ws || ws.readyState !== WebSocket.OPEN) continue;
        out.sessions += 1;
        if (!info) continue;
        if (info.authenticated) out.signedIn += 1;
        if (info.deviceId || info.deviceApp) out.devices += 1;
        else if (info.phone && typeof info.phone === 'object') out.phones += 1;
        else if (info.authenticated) out.desktops += 1;
    }
    return out;
}

// the server's resources, kept for the feeds (they sample outside a request)
let resources = null;

function wsServerOf(gr, ctx) {
    let wsServer = (ctx && ctx.wsServer) || null;
    if (!wsServer || !wsServer.clients) {
        try { wsServer = gr && gr.getWebSocketServer(); } catch (_) { wsServer = null; }
    }
    return wsServer && wsServer.clients ? wsServer : null;
}

/** Clients (#898): agentClientBridge's list plus what this page shows beside it. items: { <clientId>: row } */
function clientRows() {
    const wsServer = wsServerOf(resources);
    if (!wsServer) return {};
    let list = [];
    try { list = require('../../agentClientBridge').listClients(resources, null, { includeDevices: true }); } catch (_) { list = []; }
    const extra = new Map();
    for (const [ws, info] of wsServer.clients) {
        if (!info || !info.clientId || ws.readyState !== WebSocket.OPEN) continue;
        extra.set(info.clientId, {
            address: info.clientIP || null,
            light: !!info.light,
            dormant: !!info.dormant,
            continuity: !!info.continuitySub,
            userAgentFull: info.userAgent || ''
        });
    }
    const items = {};
    for (const row of list) {
        if (!row || !row.clientId) continue;
        items[row.clientId] = { ...row, ...(extra.get(row.clientId) || {}) };
    }
    return items;
}

const clientsFeed = statusHub.define({
    name: 'server_clients',
    pushType: 'server_clients_status',
    intervalMs: 5000,
    allow: isAdmin,
    async sample() { return clientRows(); }
});

function frontGate(globalResources) {
    try {
        const status = siteAccess.publicSiteAccessStatus(globalResources);
        const cfg = siteAccess.readSiteAccessSecure(globalResources);
        return { enabled: !!status.configured, cover: (cfg && cfg.homepage) || status.homepage || null };
    } catch (_) {
        return null;
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[307-serverManagerHandler] registerPackets: missing handlersCtx');
        return;
    }
    resources = handlersCtx.globalResources;

    wsPacketRegistry.registerWsPacket('server_client_action', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        if (!isAdmin(clientInfo)) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        const clientId = String(message.clientId || '');
        const action = String(message.action || '');
        let data;
        const wsServer = wsServerOf(handlersCtx.globalResources, ctx);
        let target = null;
        if (wsServer) {
            for (const [sock, info] of wsServer.clients) {
                if (info && info.clientId === clientId && sock.readyState === WebSocket.OPEN) { target = sock; break; }
            }
        }
        if (!target) data = { success: false, error: 'That client is no longer connected.' };
        else if (action === 'resync') {
            handlersCtx.sendToClient(target, { type: 'client_resync', data: { by: 'administrator' }, timestamp: new Date().toISOString() });
            data = { success: true, clientId, action };
        } else if (action === 'disconnect') {
            handlersCtx.sendToClient(target, { type: 'client_disconnect', data: { by: 'administrator' }, timestamp: new Date().toISOString() });
            // the client closes itself on client_disconnect; one that does not (an older page) is closed here
            setTimeout(() => { try { if (target.readyState === WebSocket.OPEN) target.close(4003, 'Disconnected by an administrator'); } catch (_) { /* gone */ } clientsFeed.poke(); }, 1500);
            data = { success: true, clientId, action };
        } else data = { success: false, error: 'Unknown action.' };
        handlersCtx.sendToClient(ws, { type: 'server_client_action_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
        clientsFeed.poke();
    }, { owner: 'serverManager' });
    wsPacketRegistry.registerWsPacket('server_manager_summary', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        if (!isAdmin(clientInfo)) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        let data;
        try {
            const gr = handlersCtx.globalResources;
            const wsServer = wsServerOf(gr, ctx);
            const processUptimeSec = Math.floor(process.uptime());
            data = {
                success: true,
                host: os.hostname(),
                platform: `${os.type()} ${os.release()}`,
                version: serverVersion(),
                osUptimeSec: Math.floor(os.uptime()),
                processUptimeSec,
                startedAt: new Date(Date.now() - processUptimeSec * 1000).toISOString(),
                clients: countClients(wsServer),
                frontGate: frontGate(gr)
            };
        } catch (error) {
            data = { success: false, error: 'Failed to read the server summary', details: error && error.message ? error.message : String(error) };
        }
        handlersCtx.sendToClient(ws, { type: 'server_manager_summary_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
    }, { owner: 'serverManager' });
}

module.exports = { registerPackets };
