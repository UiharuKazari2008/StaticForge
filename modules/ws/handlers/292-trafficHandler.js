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
    trafficService.startScheduler();
}

module.exports = {
    registerPackets
};
