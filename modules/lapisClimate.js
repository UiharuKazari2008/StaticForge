'use strict';

/**
 * Lapis Remote (Yozora #835): the automatic climate choice for a remote start.
 *
 * The cabin estimate is Yukimi's Home Assistant sensor, unchanged:
 *   estimate °F = outdoor °F + shortwave radiation (W/m²) x (1 - cloud cover / 100) x 0.015
 *
 * Her sensor then picked from a seven-step table (85 / 80 / 78 / 74 / 70 / 65 / 61 °F). She asked
 * (Nov 15 2026) for it to scale by itself instead: "the table was a limitation at the time". So the
 * settings are a few anchors and everything between them is a straight line:
 *   comfort         the set temperature when the cabin is already mild (default 74)
 *   coldAt / hotAt  the estimates at which the car gets its warmest / coolest setting (33 / 95)
 *   seatHeatBelow / seatCoolAbove   where seat heat / seat cooling starts (56 / 76); the mild point,
 *                   where the set temperature equals `comfort`, is halfway between them
 *   defrostBelow    front defrost under this estimate (41)
 *   wheel, seats    heated wheel and glass, heated / cooled seats: used at all, or never
 * With the defaults the line passes within a degree or two of every step of the old table, and the
 * seat and wheel levels change at the same estimates the table used.
 *
 * Codes are BlueLink's: heating 0 off, 3 steering wheel, 4 steering wheel + rear glass + mirrors;
 * seat 0 off, 6 / 7 / 8 heat low / medium / high, 3 / 4 / 5 cool low / medium / high.
 *
 * Pure: no I/O. lapisService feeds it the weather at the car and the saved anchors.
 */

const SOLAR_GAIN_F_PER_WM2 = 0.015;
const TEMP_MIN = 62;
const TEMP_MAX = 82;

const DEFAULTS = Object.freeze({ comfort: 74, coldAt: 33, hotAt: 95, seatHeatBelow: 56, seatCoolAbove: 76, defrostBelow: 41, wheel: true, seats: true });

const HEATING_TEXT = { 0: 'Off', 1: 'Heat (wheel, rear glass)', 2: 'Heat (rear glass)', 3: 'Heat (wheel)', 4: 'Heat (all)' };
const SEAT_TEXT = { 0: 'Off', 2: 'Off', 3: 'Cool, low', 4: 'Cool, medium', 5: 'Cool, high', 6: 'Heat, low', 7: 'Heat, medium', 8: 'Heat, high' };

function num(v) {
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The cabin estimate in °F: outdoor plus what the sun adds through the cloud. */
function interiorEstimate({ outdoorF, shortwave, cloudCover } = {}) {
    const outdoor = num(outdoorF);
    if (outdoor === null) return null;
    const rad = Math.max(0, num(shortwave) || 0);
    const clouds = clamp(num(cloudCover) || 0, 0, 100);
    const gain = rad * (1 - clouds / 100) * SOLAR_GAIN_F_PER_WM2;
    return Math.round((outdoor + gain) * 10000) / 10000;
}

/** Saved anchors made whole and consistent (each stays on its side of the others). */
function cleanSettings(c) {
    const s = c && typeof c === 'object' ? c : {};
    const pick = (k, lo, hi) => {
        const n = num(s[k]);
        return n === null ? DEFAULTS[k] : Math.round(clamp(n, lo, hi));
    };
    const out = {
        comfort: pick('comfort', TEMP_MIN + 2, TEMP_MAX - 2),
        coldAt: pick('coldAt', -20, 50),
        hotAt: pick('hotAt', 80, 120),
        seatHeatBelow: pick('seatHeatBelow', 30, 70),
        seatCoolAbove: pick('seatCoolAbove', 65, 95),
        defrostBelow: pick('defrostBelow', 20, 55),
        wheel: s.wheel !== false,
        seats: s.seats !== false,
    };
    if (out.seatHeatBelow <= out.coldAt) out.seatHeatBelow = out.coldAt + 5;
    if (out.seatCoolAbove <= out.seatHeatBelow) out.seatCoolAbove = out.seatHeatBelow + 5;
    if (out.hotAt <= out.seatCoolAbove) out.hotAt = out.seatCoolAbove + 5;
    return out;
}

/**
 * The remote start settings for a cabin estimate.
 * @returns {{ interiorF, temp, defrost, heating, seat, mode, heatingText, seatText, reason }|null}
 */
function choose(interiorF, settings) {
    const est = num(interiorF);
    if (est === null) return null;
    const c = cleanSettings(settings);
    const mild = (c.seatHeatBelow + c.seatCoolAbove) / 2;
    // the set temperature: a line from the warmest setting at coldAt, through comfort at the mild
    // point, to the coolest at hotAt
    let temp;
    if (est <= mild) temp = c.comfort + ((TEMP_MAX - c.comfort) * (mild - est)) / (mild - c.coldAt);
    else temp = c.comfort - ((c.comfort - TEMP_MIN) * (est - mild)) / (c.hotAt - mild);
    temp = Math.round(clamp(temp, TEMP_MIN, TEMP_MAX));

    // seats: low from the start point, medium over the last third or so, high at the full point
    let seat = 0;
    if (c.seats && est < c.seatHeatBelow) {
        const f = (c.seatHeatBelow - est) / (c.seatHeatBelow - c.coldAt);
        seat = f > 1 ? 8 : f > 0.65 ? 7 : 6;
    } else if (c.seats && est >= c.seatCoolAbove) {
        const f = (est - c.seatCoolAbove) / (c.hotAt - c.seatCoolAbove);
        seat = f >= 1 ? 5 : f >= 0.47 ? 4 : 3;
    }
    // heated wheel with the seat heat; rear glass and mirrors too once it is as cold as coldAt
    const heating = c.wheel && est < c.seatHeatBelow ? (est < c.coldAt ? 4 : 3) : 0;
    const defrost = est < c.defrostBelow;

    const mode = est < c.seatHeatBelow ? 'heat' : est >= c.seatCoolAbove ? 'cool' : 'mild';
    const parts = [];
    if (mode === 'heat') parts.push('heat');
    if (mode === 'cool') parts.push('cooling');
    if (defrost) parts.push('front defrost');
    if (seat >= 6) parts.push(`seat heat ${['low', 'medium', 'high'][seat - 6]}`);
    else if (seat >= 3) parts.push(`seat cooling ${['low', 'medium', 'high'][seat - 3]}`);
    if (heating === 4) parts.push('wheel, rear glass and mirrors');
    else if (heating === 3) parts.push('wheel');
    return { interiorF: est, temp, defrost, heating, seat, mode, heatingText: HEATING_TEXT[heating] || 'Off', seatText: SEAT_TEXT[seat] || 'Off', reason: parts };
}

/** Weather at the car in, remote start settings out. */
function fromWeather(weather, settings) {
    const interior = interiorEstimate(weather);
    if (interior === null) return null;
    const pick = choose(interior, settings);
    const outdoor = num(weather.outdoorF);
    return { ...pick, outdoorF: outdoor, solarGainF: Math.round((interior - outdoor) * 10) / 10 };
}

/** The line as a few points, for the settings page's preview: [{ est, temp, seat, heating, defrost }]. */
function preview(settings, points = [10, 25, 35, 45, 55, 66, 75, 85, 95, 105]) {
    return points.map((est) => {
        const p = choose(est, settings);
        return { est, temp: p.temp, seat: p.seat, heating: p.heating, defrost: p.defrost };
    });
}

module.exports = { SOLAR_GAIN_F_PER_WM2, DEFAULTS, TEMP_MIN, TEMP_MAX, HEATING_TEXT, SEAT_TEXT, interiorEstimate, cleanSettings, choose, fromWeather, preview };
