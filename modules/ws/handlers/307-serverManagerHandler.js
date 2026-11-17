const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const wsPacketRegistry = require('../wsPacketRegistry');
const siteAccess = require('../../siteAccess');
const statusHub = require('../statusHub');
const hardwareSensors = require('../../hardwareSensors');

// Server Manager (Yozora #831 slice 5; public/scripts/comp/mmcServerManager.js): the root page's
// Server Summary, and the Hardware and Sensors feed (#896). Read only; signed-in administrators.
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
    wsPacketRegistry.registerWsPacket('server_manager_summary', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        if (!isAdmin(clientInfo)) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        let data;
        try {
            const gr = handlersCtx.globalResources;
            let wsServer = ctx.wsServer || null;
            if (!wsServer || !wsServer.clients) {
                try { wsServer = gr.getWebSocketServer(); } catch (_) { wsServer = null; }
            }
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
