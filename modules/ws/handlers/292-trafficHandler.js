const wsPacketRegistry = require('../wsPacketRegistry');
const trafficService = require('../../trafficService');

// Traffic (Yozora #795): Melaton Mobile's Traffic app and its Today item. Every traffic read goes
// through modules/trafficService.js (Google Routes + Waze, monthly budgets, the leave-time scheduler).
// Home, Work and the route are the household admin's commute: admin (and dev_admin test tabs) only.
//
//   traffic_get            {}                          { settings, latest: { work, home }, providers }
//   traffic_check          { direction, force? }       a fresh report for 'work' or 'home'
//   traffic_advise         { direction, force? }       the leave advisor (Google only)
//   traffic_settings_save  { settings }                admins; merged into config `traffic`
//   traffic_where          {}                          { lat, lon, source, accuracyKm }: the phone's place by
//                                                      its IP, for a browser without device location (a
//                                                      home-network or unknown IP answers the configured place)
//
// Broadcasts to admin clients:
//   traffic_updated           { direction, report }                 after every check
//   traffic_report            { kind: 'scheduled' | 'go', direction, report, advice?, error? }
//   traffic_settings_changed  { settings }

const canRead = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));
const isAdmin = (info) => !!(info && info.userType === 'admin');

function reply(handlersCtx, ws, message, data) {
    handlersCtx.sendToClient(ws, {
        type: `${message.type}_response`,
        requestId: message.requestId,
        data,
        timestamp: new Date().toISOString()
    });
}

function fail(handlersCtx, ws, message, error, fallback) {
    handlersCtx.sendError(ws, (error && error.message) || fallback, (error && error.code) || 'TRAFFIC_ERROR', message.requestId);
}

function guard(handlersCtx, ws, message, clientInfo, admin) {
    if (admin ? isAdmin(clientInfo) : canRead(clientInfo)) return true;
    handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
    return false;
}

async function handleGet(handlersCtx, ws, message, clientInfo) {
    if (!guard(handlersCtx, ws, message, clientInfo)) return;
    try {
        reply(handlersCtx, ws, message, { settings: trafficService.getSettings(), latest: trafficService.getLatest(), providers: trafficService.providers() });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Traffic could not be loaded');
    }
}

async function handleCheck(handlersCtx, ws, message, clientInfo) {
    if (!guard(handlersCtx, ws, message, clientInfo)) return;
    try {
        const report = await trafficService.check(message.direction, { force: !!message.force });
        reply(handlersCtx, ws, message, { report, providers: trafficService.providers() });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Traffic could not be checked');
    }
}

async function handleAdvise(handlersCtx, ws, message, clientInfo) {
    if (!guard(handlersCtx, ws, message, clientInfo)) return;
    try {
        const advice = await trafficService.advise(message.direction, { force: !!message.force });
        reply(handlersCtx, ws, message, { advice, providers: trafficService.providers() });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'The leave advisor could not be loaded');
    }
}

async function handleWhere(handlersCtx, ws, message, clientInfo) {
    if (!guard(handlersCtx, ws, message, clientInfo)) return;
    try {
        const loc = await require('../../sidebarGadgets').resolveClientLocation(handlersCtx.globalResources, clientInfo && clientInfo.clientIP);
        if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) {
            reply(handlersCtx, ws, message, { available: false });
            return;
        }
        const configured = loc.source === 'configured' || loc.configured;
        reply(handlersCtx, ws, message, {
            available: true,
            lat: Math.round(Number(loc.lat) * 1e4) / 1e4,
            lon: Math.round(Number(loc.lon) * 1e4) / 1e4,
            source: configured ? 'configured' : 'client_ip',
            // an IP lookup is a city at best; the configured place is where the server is
            accuracyKm: configured ? 0.5 : 25
        });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'The location could not be found');
    }
}

async function handleSave(handlersCtx, ws, message, clientInfo) {
    if (!guard(handlersCtx, ws, message, clientInfo, true)) return;
    try {
        reply(handlersCtx, ws, message, { settings: await trafficService.saveSettings(message.settings || {}) });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Traffic settings could not be saved');
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[292-trafficHandler] registerPackets: missing handlersCtx');
        return;
    }
    trafficService.bind(handlersCtx.globalResources);
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'traffic', ...meta });
    };
    reg('traffic_get', handleGet);
    reg('traffic_check', handleCheck);
    reg('traffic_advise', handleAdvise);
    reg('traffic_settings_save', handleSave, { destructive: true });
    reg('traffic_where', handleWhere);
    trafficService.startScheduler();
}

module.exports = {
    registerPackets
};
