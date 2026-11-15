'use strict';

/**
 * Lapis Remote (Yozora #835): the automatic climate choice for a remote start.
 *
 * A port of Yukimi's Home Assistant sensors (Nov 14 2026), unchanged in its numbers:
 *   sensor.car_interior_temperature = outdoor °F + solar gain, where
 *       gain = shortwave radiation (W/m²) x (1 - cloud cover / 100) x 0.015 °F per W/m²
 *   sensor.car_climate = a step table on that estimate (cut to a whole number, as `| int` did)
 *       giving the set temperature, front defrost, the heated wheel / glass code and the seat code.
 *
 * Codes are the BlueLink ones (the Home Assistant integration's):
 *   heating  0 off, 3 steering wheel, 4 steering wheel + rear glass + mirrors
 *   seat     0 off, 6 / 7 / 8 heat low / medium / high, 3 / 4 / 5 cool low / medium / high
 *
 * Pure: no I/O. lapisService feeds it the weather at the car and may pass a saved table.
 */

const SOLAR_GAIN_F_PER_WM2 = 0.015;

// each row applies while the estimate is below `below`; the last row (no `below`) takes the rest
const DEFAULT_TABLE = Object.freeze([
    { below: 33, temp: 85, defrost: true, heating: 4, seat: 8 },
    { below: 41, temp: 80, defrost: true, heating: 3, seat: 7 },
    { below: 56, temp: 78, defrost: false, heating: 3, seat: 6 },
    { below: 76, temp: 74, defrost: false, heating: 0, seat: 0 },
    { below: 85, temp: 70, defrost: false, heating: 0, seat: 3 },
    { below: 95, temp: 65, defrost: false, heating: 0, seat: 4 },
    { temp: 61, defrost: false, heating: 0, seat: 5 },
]);

const HEATING_TEXT = { 0: 'Off', 1: 'Heat (wheel, rear glass)', 2: 'Heat (rear glass)', 3: 'Heat (wheel)', 4: 'Heat (all)' };
const SEAT_TEXT = { 0: 'Off', 2: 'Off', 3: 'Cool, low', 4: 'Cool, medium', 5: 'Cool, high', 6: 'Heat, low', 7: 'Heat, medium', 8: 'Heat, high' };

function num(v) {
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
}

/** The cabin estimate in °F: outdoor plus what the sun adds through the cloud. */
function interiorEstimate({ outdoorF, shortwave, cloudCover } = {}) {
    const outdoor = num(outdoorF);
    if (outdoor === null) return null;
    const rad = Math.max(0, num(shortwave) || 0);
    const clouds = Math.min(100, Math.max(0, num(cloudCover) || 0));
    const gain = rad * (1 - clouds / 100) * SOLAR_GAIN_F_PER_WM2;
    return Math.round((outdoor + gain) * 10000) / 10000;
}

function cleanTable(table) {
    if (!Array.isArray(table) || !table.length) return DEFAULT_TABLE;
    const rows = table
        .map((r) => ({
            below: num(r && r.below),
            temp: num(r && r.temp),
            defrost: !!(r && r.defrost),
            heating: num(r && r.heating) || 0,
            seat: num(r && r.seat) || 0,
        }))
        .filter((r) => r.temp !== null);
    if (!rows.length) return DEFAULT_TABLE;
    // open-ended row last, the rest by rising threshold
    rows.sort((a, b) => (a.below === null ? 1 : b.below === null ? -1 : a.below - b.below));
    if (rows[rows.length - 1].below !== null) rows.push({ ...rows[rows.length - 1], below: null });
    return rows;
}

/**
 * The remote start settings for a cabin estimate.
 * @returns {{ interiorF, basis, temp, defrost, heating, seat, mode, heatingText, seatText, reason }|null}
 */
function choose(interiorF, table) {
    const est = num(interiorF);
    if (est === null) return null;
    const basis = Math.trunc(est);
    const rows = cleanTable(table);
    const row = rows.find((r) => r.below == null || basis < r.below);
    const mode = row.seat >= 6 || row.heating ? 'heat' : row.seat >= 3 ? 'cool' : 'mild';
    const parts = [];
    if (mode === 'heat') parts.push('heat');
    if (mode === 'cool') parts.push('cooling');
    if (row.defrost) parts.push('front defrost');
    if (row.seat >= 6) parts.push('seat heat');
    else if (row.seat >= 3) parts.push('seat cooling');
    if (row.heating === 4) parts.push('wheel, rear glass and mirrors');
    else if (row.heating === 3) parts.push('wheel');
    else if (row.heating) parts.push('rear glass');
    return {
        interiorF: est,
        basis,
        temp: row.temp,
        defrost: row.defrost,
        heating: row.heating,
        seat: row.seat,
        mode,
        heatingText: HEATING_TEXT[row.heating] || 'Off',
        seatText: SEAT_TEXT[row.seat] || 'Off',
        reason: parts,
    };
}

/** Weather at the car in, remote start settings out. */
function fromWeather(weather, table) {
    const interior = interiorEstimate(weather);
    if (interior === null) return null;
    const pick = choose(interior, table);
    const outdoor = num(weather.outdoorF);
    return { ...pick, outdoorF: outdoor, solarGainF: Math.round((interior - outdoor) * 10) / 10 };
}

module.exports = { SOLAR_GAIN_F_PER_WM2, DEFAULT_TABLE, HEATING_TEXT, SEAT_TEXT, interiorEstimate, choose, fromWeather, cleanTable };
