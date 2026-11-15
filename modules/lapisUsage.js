'use strict';

/**
 * Lapis Remote (Yozora #835): what the car's history says about how it is used.
 * Pure functions over the samples lapisService records ({ t, odo, fuel, range, ... }, oldest first):
 * miles per day, fill-ups, how far a percent of the tank goes, and the day to refuel by.
 *
 * The refuel day walks forward from today, taking each day's expected miles off the tank until the
 * next day would end under the reserve. A day's expected miles come from that weekday's own history
 * when there is enough of it, else from the work schedule (commute there and back on work days).
 */

const DAY = 24 * 60 * 60 * 1000;
const FILLUP_RISE_PCT = 8; // the tank reading going up this much between samples is a fill-up
const MIN_WEEKDAY_SAMPLES = 2;

function dayKey(t, timeZone) {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

function weekdayOf(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function valid(n) {
    return typeof n === 'number' && Number.isFinite(n);
}

/** Per local day: miles driven, fuel percent used, the day's last readings. Days without a sample are absent. */
function daily(samples, timeZone) {
    const days = new Map();
    let prev = null;
    let rose = false;
    for (const s of samples || []) {
        if (!s || !valid(s.t)) continue;
        const key = dayKey(s.t, timeZone);
        let d = days.get(key);
        if (!d) {
            d = { day: key, weekday: weekdayOf(key), miles: 0, fuelUsed: 0, fillups: 0, odo: null, fuel: null, samples: 0 };
            days.set(key, d);
        }
        d.samples++;
        if (prev) {
            if (valid(s.odo) && valid(prev.odo) && s.odo > prev.odo && s.odo - prev.odo < 1500) d.miles += s.odo - prev.odo;
            if (valid(s.fuel) && valid(prev.fuel)) {
                if (s.fuel - prev.fuel >= FILLUP_RISE_PCT) { if (!rose) d.fillups++; rose = true; }
                else if (s.fuel < prev.fuel) { d.fuelUsed += prev.fuel - s.fuel; rose = false; }
            }
        }
        if (valid(s.odo)) d.odo = s.odo;
        if (valid(s.fuel)) d.fuel = s.fuel;
        if (valid(s.odo) || valid(s.fuel)) prev = { odo: valid(s.odo) ? s.odo : prev && prev.odo, fuel: valid(s.fuel) ? s.fuel : prev && prev.fuel };
    }
    return [...days.values()].map((d) => ({ ...d, miles: Math.round(d.miles * 10) / 10, fuelUsed: Math.round(d.fuelUsed * 10) / 10 }));
}

/** Fill-ups: { t, from, to, odo, milesSinceLast }. */
function fillups(samples) {
    const out = [];
    let prev = null;
    let lastOdo = null;
    let rising = false;
    for (const s of samples || []) {
        if (!s || !valid(s.fuel)) continue;
        const last = out[out.length - 1];
        if (prev && last && rising && s.fuel > prev.fuel && s.t - last.t <= 3 * 60 * 60 * 1000) {
            // the same fill-up seen over two reports (an hourly average catches the tank half full)
            last.to = s.fuel;
        } else if (prev && s.fuel - prev.fuel >= FILLUP_RISE_PCT) {
            const odo = valid(s.odo) ? s.odo : prev.odo;
            out.push({ t: s.t, from: prev.fuel, to: s.fuel, odo: valid(odo) ? odo : null, milesSinceLast: valid(odo) && valid(lastOdo) ? Math.round((odo - lastOdo) * 10) / 10 : null });
            if (valid(odo)) lastOdo = odo;
            rising = true;
        } else if (prev && s.fuel < prev.fuel) rising = false;
        if (lastOdo === null && valid(s.odo)) lastOdo = s.odo;
        prev = { fuel: s.fuel, odo: valid(s.odo) ? s.odo : prev && prev.odo, t: s.t };
    }
    return out;
}

/**
 * Miles one percent of the tank covers. Measured over the history when at least 150 miles and 10 %
 * were seen, else rated: tank gallons x mpg / 100.
 */
function milesPerPercent(samples, { tankGal = 13.2, mpg = 47 } = {}) {
    let miles = 0;
    let pct = 0;
    let prev = null;
    for (const s of samples || []) {
        if (!s || !valid(s.odo) || !valid(s.fuel)) continue;
        // only driving burns fuel: a level that moves while the odometer stands still is the gauge, not the tank
        if (prev && s.odo > prev.odo && s.odo - prev.odo < 1500 && s.fuel <= prev.fuel) {
            miles += s.odo - prev.odo;
            pct += prev.fuel - s.fuel;
        }
        prev = s;
    }
    const rated = (tankGal * mpg) / 100;
    if (miles >= 150 && pct >= 10) {
        const measured = miles / pct;
        // a reading far off the rated figure is a gauge artefact, not economy
        if (measured > rated * 0.4 && measured < rated * 1.8) return { value: Math.round(measured * 100) / 100, basis: 'measured', miles: Math.round(miles), mpg: Math.round((measured * 100) / tankGal * 10) / 10 };
    }
    return { value: Math.round(rated * 100) / 100, basis: 'rated', miles: Math.round(miles), mpg };
}

function median(list) {
    const a = list.slice().sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Expected miles for each weekday (0 Sunday): { miles[7], basis[7] }.
 * History: the median of that weekday's last eight recorded days. Otherwise the schedule:
 * work days drive the commute both ways plus `errandMiles`, other days `offDayMiles`.
 */
function weekdayMiles(days, { workDays = [1, 2, 3, 4, 5], commuteMiles = null, errandMiles = 4, offDayMiles = 12 } = {}) {
    const miles = [];
    const basis = [];
    for (let wd = 0; wd < 7; wd++) {
        const seen = (days || []).filter((d) => d.weekday === wd).slice(-8).map((d) => d.miles);
        if (seen.length >= MIN_WEEKDAY_SAMPLES) {
            miles.push(Math.round(median(seen) * 10) / 10);
            basis.push('history');
        } else if (workDays.includes(wd) && valid(commuteMiles)) {
            miles.push(Math.round((commuteMiles * 2 + errandMiles) * 10) / 10);
            basis.push('schedule');
        } else {
            miles.push(workDays.includes(wd) ? 30 : offDayMiles);
            basis.push('default');
        }
    }
    return { miles, basis };
}

/**
 * The day to refuel by.
 * @returns {{ day, daysLeft, milesLeft, perDay[], reservePct, basis }|null}
 *   day: 'YYYY-MM-DD', the last day that still ends at or above the reserve (today when already under it)
 */
function refuelBy({ fuelPct, milesPerPct, weekday, todayKey, milesToday = 0, reservePct = 15, horizon = 60 }) {
    if (!valid(fuelPct) || !valid(milesPerPct) || milesPerPct <= 0 || !weekday || !todayKey) return null;
    const milesLeft = Math.max(0, (fuelPct - reservePct) * milesPerPct);
    let left = milesLeft;
    const perDay = [];
    let day = todayKey;
    for (let i = 0; i < horizon; i++) {
        const key = addDays(todayKey, i);
        const wd = weekdayOf(key);
        // today: only what is still expected to be driven
        const need = i === 0 ? Math.max(0, weekday.miles[wd] - milesToday) : weekday.miles[wd];
        perDay.push({ day: key, miles: need, basis: weekday.basis[wd] });
        if (need > left) break;
        left -= need;
        day = key;
        if (i === horizon - 1) return { day: null, daysLeft: horizon, milesLeft: Math.round(milesLeft), perDay, reservePct, beyond: true };
    }
    // `day` is the last day fully covered; refuel on it (before the next day's driving)
    const daysLeft = Math.round((Date.parse(day) - Date.parse(todayKey)) / DAY);
    // the day whose driving would cross the reserve, and how far short the tank is for it
    const short = perDay[perDay.length - 1];
    const crosses = short && short.miles > 0 ? { day: short.day, miles: short.miles, left: Math.round(left) } : null;
    return { day, daysLeft, milesLeft: Math.round(milesLeft), perDay: perDay.slice(0, 14), reservePct, beyond: false, crosses };
}

/**
 * Trips between samples: the odometer moved. { from, to, miles, fromLoc, toLoc, fuelUsed }.
 * Consecutive moving samples closer than `gapMs` join into one trip.
 */
function trips(samples, { gapMs = 25 * 60 * 1000 } = {}) {
    const out = [];
    let prev = null;
    let cur = null;
    for (const s of samples || []) {
        if (!s || !valid(s.odo)) continue;
        if (prev && s.odo > prev.odo && s.odo - prev.odo < 1500) {
            if (cur && prev.t - cur.to <= gapMs) {
                cur.to = s.t;
                cur.miles += s.odo - prev.odo;
                cur.toLoc = loc(s) || cur.toLoc;
                if (valid(s.fuel) && valid(prev.fuel) && s.fuel < prev.fuel) cur.fuelUsed += prev.fuel - s.fuel;
            } else {
                cur = { from: prev.t, to: s.t, miles: s.odo - prev.odo, fromLoc: loc(prev), toLoc: loc(s), fuelUsed: valid(s.fuel) && valid(prev.fuel) && s.fuel < prev.fuel ? prev.fuel - s.fuel : 0 };
                out.push(cur);
            }
        }
        prev = s;
    }
    return out.map((t) => ({ ...t, miles: Math.round(t.miles * 10) / 10, fuelUsed: Math.round(t.fuelUsed * 10) / 10 }));
}

function loc(s) {
    return valid(s.lat) && valid(s.lon) ? { lat: s.lat, lon: s.lon } : null;
}

/** Great-circle miles between two { lat, lon }. */
function milesBetween(a, b) {
    if (!a || !b || !valid(a.lat) || !valid(a.lon) || !valid(b.lat) || !valid(b.lon)) return null;
    const R = 3958.8;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/** Thin a series to at most `max` points, keeping the first and last. */
function thin(points, max) {
    if (!Array.isArray(points) || points.length <= max) return points || [];
    const out = [];
    const step = (points.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
    return out;
}

module.exports = { dayKey, weekdayOf, addDays, daily, fillups, milesPerPercent, weekdayMiles, refuelBy, trips, milesBetween, thin, FILLUP_RISE_PCT };
