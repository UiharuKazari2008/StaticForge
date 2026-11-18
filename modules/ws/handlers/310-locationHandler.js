const wsPacketRegistry = require('../wsPacketRegistry');
const locationService = require('../../locationService');

// Location (Yozora #907): Home / Work, the common location lookup and reverse lookups. Every app that
// needs a place goes through modules/locationService.js (and on the phone through wmLocation.js).
// Household places: admin and dev_admin read; admins save.
//
//   location_places_get   {}                                   { places: { home, work }, specificities }
//   location_places_save  { home?, work? }                     admins; a place, or null to clear
//   location_resolve      { query, min?, max?, limit?, near? }  { results: [place] } (no finer than max,
//                                                              no coarser than min)
//   location_reverse      { lat, lon, specificity? }           { place } (cut to the specificity)
//
// Broadcast: location_places_changed { places }

const canRead = (info) => !!(info && /^(admin|dev_admin)$/.test(String(info.userType || '')));
const isAdmin = (info) => !!(info && info.userType === 'admin');

function reply(ctx, ws, message, data) {
    ctx.sendToClient(ws, { type: `${message.type}_response`, requestId: message.requestId, data, timestamp: new Date().toISOString() });
}

function guard(ctx, ws, message, info, admin) {
    if (admin ? isAdmin(info) : canRead(info)) return true;
    ctx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
    return false;
}

function registerPackets(ctx) {
    if (!ctx) { console.warn('[310-locationHandler] registerPackets: missing handlersCtx'); return; }
    locationService.bind(ctx.globalResources);
    const reg = (type, admin, fn, meta = {}) => wsPacketRegistry.registerWsPacket(type, async ({ ws, message, clientInfo }) => {
        if (!guard(ctx, ws, message, clientInfo, admin)) return;
        try {
            reply(ctx, ws, message, await fn(message || {}));
        } catch (error) {
            ctx.sendError(ws, (error && error.message) || 'Location failed', (error && error.code) || 'LOCATION_ERROR', message.requestId);
        }
    }, { owner: 'location', ...meta });
    reg('location_places_get', false, async () => ({ places: locationService.getPlaces(), specificities: locationService.SPECIFICITY }));
    reg('location_places_save', true, async (m) => ({ places: await locationService.savePlaces({ ...('home' in m ? { home: m.home } : {}), ...('work' in m ? { work: m.work } : {}) }) }), { destructive: true });
    reg('location_resolve', false, async (m) => ({ results: await locationService.resolve(m.query, { min: m.min, max: m.max, limit: m.limit, near: m.near }) }));
    reg('location_reverse', false, async (m) => ({ place: await locationService.reverse(m.lat, m.lon, { specificity: m.specificity }) }));
}

module.exports = { registerPackets };
