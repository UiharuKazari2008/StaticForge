const wsPacketRegistry = require('../wsPacketRegistry');
const weatherService = require('../../weatherService');
const sidebarGadgets = require('../../sidebarGadgets');

// Weather (Yozora #780): every weather read goes through modules/weatherService.js, which caches,
// rate limits and picks the provider (the Apple Weather service key, else Open-Meteo).
//
//   weather_forecast   { lat, lon, lang? } or { here: true }   any signed-in client (Melaton Mobile's Weather)
//   weather_geocode    { name, count? }                       any signed-in client (Add Location)
//   weather_radar      {}                                     radar frames + tile URL templates
//   weather_alert      { id, lang? }                          the full text of an Apple Weather alert
//   weather_alerts_active {}                                  the primary location's active alerts
//
// Broadcasts (weatherService alert monitor, every 5 min on the configured home location):
//   weather_alert_issued    { alert, place, source }   a new alert, once (to every signed-in client)
//   weather_alerts_changed  { place, alerts, source, checkedAt }   the active list changed
//
// The Apple Weather account is a Service Key (apiKeyManager `appleweather`, Dreamscape CardSpace).
// { here: true } is the Sidebar gadget's place (client IP, then the configured home): admins only,
// like sidebar_weather, because it reveals the configured home.

function isAdmin(clientInfo) {
    return !!(clientInfo && clientInfo.userType === 'admin');
}

/** Without null fields (a forecast is a quarter nulls): the clients read a missing field as no data. */
function compact(value) {
    if (Array.isArray(value)) return value.map(compact);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    Object.keys(value).forEach((k) => {
        if (value[k] !== null && value[k] !== undefined) out[k] = compact(value[k]);
    });
    return out;
}

function reply(handlersCtx, ws, message, data) {
    handlersCtx.sendToClient(ws, {
        type: `${message.type}_response`,
        requestId: message.requestId,
        data: compact(data),
        timestamp: new Date().toISOString()
    });
}

function fail(handlersCtx, ws, message, error, fallback) {
    handlersCtx.sendError(ws, (error && error.message) || fallback, (error && error.code) || 'WEATHER_ERROR', message.requestId);
}

function requireAdmin(handlersCtx, ws, message, clientInfo) {
    if (isAdmin(clientInfo)) return true;
    handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
    return false;
}

async function handleForecast(handlersCtx, ws, message, clientInfo) {
    try {
        weatherService.bind(handlersCtx.globalResources);
        let { lat, lon } = message;
        let place = null;
        if (message.here) {
            if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
            const g = await sidebarGadgets.getClientWeather(handlersCtx.globalResources, clientInfo && clientInfo.clientIP);
            if (!g || !g.available || !g.location || !Number.isFinite(g.location.lat)) {
                reply(handlersCtx, ws, message, { available: false });
                return;
            }
            lat = g.location.lat;
            lon = g.location.lon;
            place = { name: g.location.city, region: g.location.region, country: g.location.country, lat, lon };
        }
        const forecast = await weatherService.getForecast(lat, lon, { lang: message.lang });
        reply(handlersCtx, ws, message, Object.assign({ available: true }, forecast, place ? { here: place } : {}));
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Weather could not be loaded');
    }
}

async function handleGeocode(handlersCtx, ws, message) {
    try {
        weatherService.bind(handlersCtx.globalResources);
        reply(handlersCtx, ws, message, { results: await weatherService.geocode(message.name, message.count) });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Places could not be searched');
    }
}

async function handleRadar(handlersCtx, ws, message) {
    try {
        weatherService.bind(handlersCtx.globalResources);
        reply(handlersCtx, ws, message, await weatherService.getRadar());
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Radar could not be loaded');
    }
}

async function handleAlert(handlersCtx, ws, message) {
    try {
        weatherService.bind(handlersCtx.globalResources);
        reply(handlersCtx, ws, message, await weatherService.getAlert(message.id, message.lang));
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'The alert could not be loaded');
    }
}

async function handleAlertsActive(handlersCtx, ws, message) {
    try {
        weatherService.bind(handlersCtx.globalResources);
        const current = weatherService.getActiveAlerts();
        reply(handlersCtx, ws, message, current.checkedAt ? current : await weatherService.pollAlerts());
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Alerts could not be loaded');
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[291-weatherHandler] registerPackets: missing handlersCtx');
        return;
    }
    weatherService.bind(handlersCtx.globalResources);
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'weather', ...meta });
    };
    reg('weather_forecast', handleForecast);
    reg('weather_geocode', handleGeocode);
    reg('weather_radar', handleRadar);
    reg('weather_alert', handleAlert);
    reg('weather_alerts_active', handleAlertsActive);
    // the primary location's alerts, broadcast to every client as they are issued
    weatherService.startAlertMonitor();
}

module.exports = {
    registerPackets
};
