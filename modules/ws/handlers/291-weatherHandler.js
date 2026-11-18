const wsPacketRegistry = require('../wsPacketRegistry');
const weatherService = require('../../weatherService');
const weatherWatch = require('../../weatherWatch');
const sidebarGadgets = require('../../sidebarGadgets');

// Weather (Yozora #780): every weather read goes through modules/weatherService.js, which caches,
// rate limits and picks the provider (the Apple Weather service key, else Open-Meteo).
//
//   weather_forecast   { lat, lon, lang?, have? } or { here: true }   any signed-in client (Melaton Mobile's Weather).
//                      The reply always carries hashes { current, minutely, daily, alerts, hourly: { day: h } }
//                      (#890 round 5, W1); with have (the hashes the page holds) only the parts that differ,
//                      hourly as { day: rows }, and same: [part, 'hourly:<day>'] for the rest
//                      (weatherService.forecastReply). Fields no page reads are left out (WIRE_DROP).
//   weather_watch      { places: [{ key, lat, lon, have? }] }   while a weather view is on screen: the server
//                      pushes weather_delta { key, ...the reply shape } when a part changes (weatherWatch.js)
//   weather_unwatch    {}                                       no weather view on screen
//   weather_geocode    { name, count? }                       any signed-in client (Add Location)
//   weather_radar      {}                                     radar frames + tile URL templates
//   weather_alert      { id, lang? }                          the full text of an Apple Weather alert
//   weather_alerts_active {}                                  active alerts of Home and Work
//   weather_places_get    {}                                  { places: { home, work }, rain, alerts }
//   weather_places_save   { places: { home?, work? } }        admins; null clears one (#792)
//   weather_rain_status   {}                                  rain now / soon at Home and Work
//   weather_place         { lat, lon }                         { name, region, country }: the town for the phone's
//                                                             own position (Current location in the app)
//
// Broadcasts (weatherService alert monitor, every 5 min on the configured home location):
//   weather_alert_issued    { alert, place: { id, label, name, ... }, source }   a new alert, once
//   weather_alerts_changed  weather_alerts_active's shape                         the active lists changed
//   weather_rain_alarm      { place, startsInMin, endsInMin, peakMmh, kind, summary }   once per rain spell
//   weather_rain_status     weather_rain_status's shape                          rain began / ended / moved
//   weather_places_changed  { places }                                           Home / Work saved
// To watchers only (weather_watch): weather_delta { key, available, ...weather_forecast's reply against the
//   page's have } - held newest-only per place for a sleeping page (websocket.js DORMANT_HOLD)
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
        // already compacted and shaped (forecastWire, made once per forecast): sent as it is, not through
        // reply()'s second compact pass
        const wire = weatherService.forecastWire(forecast);
        const body = wire ? weatherService.forecastReply(wire, message.have) : {};
        handlersCtx.sendToClient(ws, {
            type: 'weather_forecast_response',
            requestId: message.requestId,
            data: Object.assign({ available: true }, body, place ? { here: compact(place) } : {}),
            timestamp: new Date().toISOString()
        });
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

async function handlePlacesGet(handlersCtx, ws, message) {
    try {
        weatherService.bind(handlersCtx.globalResources);
        reply(handlersCtx, ws, message, { places: weatherService.getPlaces(), rain: weatherService.getRainStatus(), alerts: weatherService.getActiveAlerts() });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Places could not be loaded');
    }
}

async function handlePlacesSave(handlersCtx, ws, message, clientInfo) {
    if (!requireAdmin(handlersCtx, ws, message, clientInfo)) return;
    try {
        weatherService.bind(handlersCtx.globalResources);
        reply(handlersCtx, ws, message, { places: await weatherService.savePlaces(message.places || {}) });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'The place could not be saved');
    }
}

async function handlePlace(handlersCtx, ws, message) {
    try {
        const lat = Number(message.lat);
        const lon = Number(message.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('lat and lon are needed');
        // rounded to ~1 km: the town, and a cache key many positions share
        const place = await sidebarGadgets.reverseGeocode(handlersCtx.globalResources, lat.toFixed(2), lon.toFixed(2));
        reply(handlersCtx, ws, message, place ? { name: place.city, region: place.region || '', country: place.country || '' } : { name: '' });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'The place could not be named');
    }
}

async function handleWatch(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        weatherService.bind(handlersCtx.globalResources);
        weatherWatch.bind(wsServer || handlersCtx);
        const keys = weatherWatch.watch(ws, message.places);
        if (message.requestId) reply(handlersCtx, ws, message, { ok: true, keys });
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Weather could not be watched');
    }
}

async function handleUnwatch(handlersCtx, ws, message) {
    weatherWatch.unwatch(ws);
    if (message.requestId) reply(handlersCtx, ws, message, { ok: true });
}

async function handleRainStatus(handlersCtx, ws, message) {
    try {
        weatherService.bind(handlersCtx.globalResources);
        reply(handlersCtx, ws, message, weatherService.getRainStatus());
    } catch (error) {
        fail(handlersCtx, ws, message, error, 'Rain status could not be loaded');
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
    reg('weather_places_get', handlePlacesGet);
    reg('weather_places_save', handlePlacesSave, { destructive: true });
    reg('weather_rain_status', handleRainStatus);
    reg('weather_place', handlePlace);
    reg('weather_watch', handleWatch);
    reg('weather_unwatch', handleUnwatch);
    // the primary location's alerts, broadcast to every client as they are issued
    weatherService.startAlertMonitor();
}

module.exports = {
    registerPackets
};
