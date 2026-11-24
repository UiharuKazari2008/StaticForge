'use strict';

/**
 * The phone's current location for weather alerts (#1127; modules/weatherService.js setHere). Admin only.
 *   weather_here_set { lat, lon, name?, region?, country? } -> { ok }
 * The monitor then watches that place beside Home and Work: its alerts and rain alarm carry the place's own name
 * (label "Current location"). Inside Home's or Work's radius the fix adds nothing (that place says it).
 */

const wsPacketRegistry = require('../wsPacketRegistry');
const weatherService = require('../../weatherService');
const sidebarGadgets = require('../../sidebarGadgets');

function registerPackets(handlersCtx) {
    wsPacketRegistry.registerWsPacket('weather_here_set', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        const h = ctx.handlers || handlersCtx;
        if (!(clientInfo && /^(admin|dev_admin)$/.test(String(clientInfo.userType || '')))) {
            h.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            weatherService.bind(h.globalResources);
            const m = message || {};
            let name = m.name;
            if (!name) {
                try {
                    const p = await sidebarGadgets.reverseGeocode(h.globalResources, Number(m.lat).toFixed(2), Number(m.lon).toFixed(2));
                    if (p) Object.assign(m, { name: p.city, region: m.region || p.region, country: m.country || p.country });
                } catch (_e) { /* named "Current location" */ }
            }
            const data = weatherService.setHere(m);
            if (message.requestId) h.sendToClient(ws, { type: 'weather_here_set_response', requestId: message.requestId, data: Object.assign({ success: true }, data), timestamp: new Date().toISOString() });
        } catch (error) {
            h.sendError(ws, error.message, error.code || 'WEATHER_FAILED', message.requestId);
        }
    }, { owner: 'weather' });
}

module.exports = { registerPackets };
