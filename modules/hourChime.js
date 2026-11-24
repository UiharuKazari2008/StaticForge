'use strict';

/**
 * Hour / half-hour chime settings (StaticForge #1108). The reminder itself runs on the phone as the CaféReady task
 * "hour-chime" (public/scripts/tasks/hour-chime.js; rule cafeready-background); the server only keeps the choices and
 * puts them in the status snapshot (phoneStatus field `chime`), so a phone gets them over the ActiveSync line.
 *
 *   { mode: 'off' | 'hour' | 'half', hourSound, halfSound, strike }
 * Sounds are names from the phone's sound set (public/sounds/wm61 without the extension); strike: the hour plays its
 * sound once per hour on a 12 h dial ("tones that tell the time").
 */

const KEY = 'chime';
const MODES = ['off', 'hour', 'half'];
const DEFAULTS = { mode: 'off', hourSound: 'Alarm-01', halfSound: 'Remind-01', strike: false };

function inbox() { return require('./notificationInbox'); }

function clean(c) {
    const o = c && typeof c === 'object' ? c : {};
    const sound = (v, d) => (/^[A-Za-z0-9._ -]{1,40}$/.test(String(v || '')) ? String(v) : d);
    return {
        mode: MODES.includes(o.mode) ? o.mode : DEFAULTS.mode,
        hourSound: sound(o.hourSound, DEFAULTS.hourSound),
        halfSound: sound(o.halfSound, DEFAULTS.halfSound),
        strike: !!o.strike
    };
}

function get(user = 'admin') {
    let raw = '';
    try { raw = inbox().getPref(user, KEY) || ''; } catch (_e) { raw = ''; }
    try { return clean(raw ? JSON.parse(raw) : null); } catch (_e) { return clean(null); }
}

/** Merge the given fields over the saved choice; returns the saved choice. */
function set(user, patch) {
    const next = clean(Object.assign({}, get(user), patch || {}));
    inbox().setPref(user, KEY, JSON.stringify(next));
    return next;
}

module.exports = { get, set, clean, MODES, DEFAULTS };
