const wsPacketRegistry = require('../wsPacketRegistry');
const lapisService = require('../../lapisService');

// Lapis Remote (Yozora #835): the car remote and status app of Melaton Mobile, over Hyundai BlueLink.
// Everything goes through modules/lapisService.js, which reads the car on its own clock and pushes
// what changed: clients never poll. The car is the household admin's: admin (and dev_admin test tabs)
// may read; only admins send commands or save.
//
//   lapis_get            {}                       { state }: status, position, climate pick, usage, maintenance, settings
//   lapis_refresh        { locate? }              admins; wakes the car for a fresh report -> { state }
//   lapis_command        { kind, options? }       admins; kind lock | unlock | start | stop -> { command }
//                                                 start options: { auto?, temp, minutes, defrost, heating, seat, passengerSeat }
//   lapis_history        { range }                week | month | quarter | year | all -> series, days, trips, fill-ups
//   lapis_vehicles       {}                       admins; the account's vehicles
//   lapis_settings_save  { settings }             admins; merged into config `lapis` -> { settings }
//   lapis_service_done   { id }                   admins; marks a maintenance item done now -> { settings }
//   lapis_picture_get    {}                       { picture, dataUrl? }: the saved car picture, if any
//   lapis_picture_save   { dataUrl | null }       admins; null goes back to the built-in picture
//
// Broadcasts to admin clients:
//   lapis_updated  { state }
//   lapis_notice   { id, kind, title, text, actions[] }   kind: unlocked | low-fuel | refuel | service | command

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

function guard(handlersCtx, ws, message, clientInfo, admin) {
    if (admin ? isAdmin(clientInfo) : canRead(clientInfo)) return true;
    handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
    return false;
}

// one handler shape: guard, run, reply; a failure answers with the service's message and code
function packet(admin, fallback, run) {
    return async (handlersCtx, ws, message, clientInfo) => {
        if (!guard(handlersCtx, ws, message, clientInfo, admin)) return;
        try {
            reply(handlersCtx, ws, message, await run(message));
        } catch (error) {
            handlersCtx.sendError(ws, (error && error.message) || fallback, (error && error.code) || 'LAPIS_ERROR', message.requestId);
        }
    };
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[293-lapisHandler] registerPackets: missing handlersCtx');
        return;
    }
    lapisService.bind(handlersCtx.globalResources);
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'lapis', ...meta });
    };
    reg('lapis_get', packet(false, 'The car could not be loaded', async () => ({ state: lapisService.getState() })));
    reg('lapis_refresh', packet(true, 'The car could not be read', async (m) => ({ state: await lapisService.read({ fresh: true, locate: !!m.locate, reason: 'refresh' }) })));
    reg('lapis_command', packet(true, 'The command could not be sent', async (m) => lapisService.command(String(m.kind || ''), m.options || {})), { destructive: true });
    reg('lapis_history', packet(false, 'The record could not be read', async (m) => lapisService.getHistory(String(m.range || 'month'))));
    reg('lapis_vehicles', packet(true, 'The vehicles could not be listed', async () => ({ vehicles: await lapisService.listVehicles() })));
    reg('lapis_settings_save', packet(true, 'The settings could not be saved', async (m) => ({ settings: await lapisService.saveSettings(m.settings || {}) })), { destructive: true });
    reg('lapis_service_done', packet(true, 'The item could not be marked', async (m) => ({ settings: await lapisService.serviceDone(String(m.id || '')) })), { destructive: true });
    reg('lapis_picture_get', packet(false, 'The picture could not be read', async () => lapisService.getPicture()));
    reg('lapis_picture_save', packet(true, 'The picture could not be saved', async (m) => lapisService.savePicture(m.dataUrl === null ? null : m.dataUrl)), { destructive: true });
    lapisService.startScheduler();
}

module.exports = {
    registerPackets
};
