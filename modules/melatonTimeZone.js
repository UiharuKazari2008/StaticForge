/**
 * The desktop's time zone for DreamOS hosts (#910). Yukimi, Nov 20 2026: "Why can't the server push the saved time
 * zone data in the desktop? The server pushes UTC time to the clients and they adjust it based on the settings in the
 * desktop."
 *
 * The zone is Melaton's own Date and Time setting (the registry's
 * HKLM\SYSTEM\CurrentControlSet\Control\TimeZoneInformation TimeZoneKeyName, config.json userGlobalSettings.registry);
 * unset, the server's zone. Every Miniport carrier gets it as the frame
 *   { type: 'miniport_timezone', name, tzif: <base64 of the server's /usr/share/zoneinfo/<name>>, at }
 * when it connects (virtualSocket.js acceptMiniport) and again when the setting changes (200-userSettingsHandler.js);
 * CaféReady (clock.rs) keeps the data and points /etc/localtime at it, so the host and its browser read the desktop's
 * zone (the image carries no tzdata). The Android app ignores the frame.
 */

const fs = require('fs');
const path = require('path');

const TZ_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation';
const ZONEINFO = '/usr/share/zoneinfo';
const MAX_TZIF = 64 * 1024;
const ZONE_RE = /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+){0,2}$/;

let serverZone = 'UTC';
try { serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { /* UTC */ }

/** name -> base64 TZif (a zone's data does not change while the server runs) */
const dataCache = new Map();
let lastSent = null;

function zoneData(name) {
    if (typeof name !== 'string' || !ZONE_RE.test(name) || name.includes('..')) return null;
    if (dataCache.has(name)) return dataCache.get(name);
    let b64 = null;
    try {
        const file = path.join(ZONEINFO, name);
        const st = fs.statSync(file);
        if (st.isFile() && st.size <= MAX_TZIF) {
            const buf = fs.readFileSync(file);
            if (buf.slice(0, 4).toString('latin1') === 'TZif') b64 = buf.toString('base64');
        }
    } catch (_) { /* no such zone here */ }
    dataCache.set(name, b64);
    return b64;
}

/** The desktop's zone: Date and Time's saved one when the server has its data, else the server's own. */
function desktopZone(config) {
    let saved = '';
    try {
        const cfg = config || require('./globalResources').getConfig() || {};
        const key = cfg.userGlobalSettings && cfg.userGlobalSettings.registry && cfg.userGlobalSettings.registry[TZ_KEY];
        saved = key && typeof key.TimeZoneKeyName === 'string' ? key.TimeZoneKeyName : '';
    } catch (_) { saved = ''; }
    return saved && zoneData(saved) ? saved : serverZone;
}

/** The carrier frame for the desktop's zone, or null when the server has no data for it. */
function frame(config) {
    const name = desktopZone(config);
    const tzif = zoneData(name);
    return tzif ? JSON.stringify({ type: 'miniport_timezone', name, tzif, at: Date.now() }) : null;
}

/** To one carrier (a Miniport that just connected). */
function sendTo(ws, config) {
    const f = frame(config);
    if (!f) return;
    try { ws.send(f); } catch (_) { /* gone */ }
}

/** The setting may have changed: every carrier gets the zone when it is not the one last pushed. */
function changed(config) {
    const name = desktopZone(config);
    if (name === lastSent) return;
    lastSent = name;
    const f = frame(config);
    if (!f) return;
    require('./ws/virtualSocket').forEachMiniport((ws) => { if (ws.readyState === 1) ws.send(f); });
}

/** Whether a settings patch touches the zone (the Date and Time dialog's save). */
function touchesZone(patch) {
    return !!(patch && patch.registry && typeof patch.registry === 'object' && Object.prototype.hasOwnProperty.call(patch.registry, TZ_KEY));
}

module.exports = { desktopZone, frame, sendTo, changed, touchesZone, TZ_KEY, serverZone: () => serverZone };
