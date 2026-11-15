'use strict';

/**
 * Hyundai BlueLink (USA) client for Lapis Remote (Yozora #835).
 * This module is the only code that talks to BlueLink; lapisService owns when it is called.
 *
 * The calls follow the open-source Home Assistant integration's library
 * (Hyundai-Kia-Connect/hyundai_kia_connect_api, HyundaiBlueLinkApiUSA.py): host
 * api.telematics.hyundaiusa.com, the web app's client id, account e-mail + password for the token
 * (30 minutes, refreshed), and the BlueLink PIN in a header for vehicle calls. The host only accepts
 * old cipher suites, so requests go through node:https with SECLEVEL 1.
 *
 * Nothing here is cached except the token and the enrolment list; nothing retries a command.
 * A status read with { refresh: true } wakes the car (it uses the 12 V battery and counts against
 * Hyundai's daily limits): lapisService decides when that is worth it.
 */

const https = require('https');

const HOST = 'api.telematics.hyundaiusa.com';
const LOGIN_API = '/v2/ac/';
const API = '/ac/v2/';
const TIMEOUT_MS = 45 * 1000;
const TEMP_MIN = 62;
const TEMP_MAX = 82;

class BlueLinkError extends Error {
    constructor(message, code, status) {
        super(message);
        this.name = 'BlueLinkError';
        this.code = code || 'BLUELINK_ERROR';
        if (status) this.status = status;
    }
}

// test seam (scripts/test-lapis-service.js): ({ method, path, headers, body }) => { status, headers, text }
let requestImpl = null;

function httpsRequest({ method, path, headers, body }) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const h = { ...headers };
        delete h['accept-encoding']; // plain bodies: no decompression step here
        if (payload) h['content-length'] = payload.length;
        const req = https.request({ host: HOST, port: 443, method, path, headers: h, ciphers: 'DEFAULT@SECLEVEL=1', timeout: TIMEOUT_MS }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('timeout', () => req.destroy(new BlueLinkError('BlueLink did not answer in time', 'TIMEOUT')));
        req.on('error', (e) => reject(e instanceof BlueLinkError ? e : new BlueLinkError(`BlueLink request failed: ${e.message}`, 'NETWORK')));
        if (payload) req.write(payload);
        req.end();
    });
}

function baseHeaders() {
    const origin = `https://${HOST}`;
    return {
        'content-type': 'application/json;charset=UTF-8',
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.142 Safari/537.36',
        host: HOST,
        origin,
        referer: `${origin}/login`,
        from: 'SPA',
        to: 'ISS',
        language: '0',
        offset: String(Math.trunc(-new Date().getTimezoneOffset() / 60)),
        refresh: 'false',
        encryptFlag: 'false',
        brandIndicator: 'H',
        client_id: 'm66129Bb-em93-SPAHYN-bZ91-am4540zp19920',
        clientSecret: 'v558o935-6nne-423i-baa8',
    };
}

function parseJson(text) {
    if (!text || !text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch (_) {
        return undefined;
    }
}

function checkBody(json, what) {
    if (json && typeof json === 'object' && 'errorCode' in json) {
        const code = String(json.errorCode);
        const sub = json.errorSubCode ? ` ${json.errorSubCode}` : '';
        const msg = json.errorMessage || 'error';
        if (code === '502' && json.errorSubCode === 'HT_534') throw new BlueLinkError(`${what}: Hyundai's request limit is reached`, 'RATE_LIMIT', 502);
        if (code === '502') throw new BlueLinkError(`${what}: BlueLink is unavailable (${msg})`, 'UNAVAILABLE', 502);
        if (code === '401' || /token|unauthori[sz]ed|credential/i.test(msg)) throw new BlueLinkError(`${what}: ${msg}`, 'AUTH', 401);
        throw new BlueLinkError(`${what}: ${msg} (${code}${sub})`, 'API', Number(code) || undefined);
    }
}

async function call(what, { method = 'GET', path, headers, body }) {
    const res = await (requestImpl || httpsRequest)({ method, path, headers, body });
    const json = parseJson(res.text);
    if (json) checkBody(json, what);
    if (res.status === 401 || res.status === 403) throw new BlueLinkError(`${what}: BlueLink refused the sign-in (HTTP ${res.status})`, 'AUTH', res.status);
    if (res.status !== 200) throw new BlueLinkError(`${what}: HTTP ${res.status} ${String(res.text || '').slice(0, 160)}`, 'HTTP', res.status);
    if (json === undefined) throw new BlueLinkError(`${what}: the answer was not JSON`, 'BAD_ANSWER');
    return { json, headers: res.headers || {} };
}

/**
 * A client for one account. `getCredentials` is read at call time: () => { username, password, pin }.
 */
function createClient(getCredentials) {
    let token = null; // { username, access, refresh, until }
    let enrollment = null; // { at, list }

    function credentials() {
        const c = (getCredentials && getCredentials()) || {};
        const username = String(c.username || '').trim();
        const password = String(c.password || '');
        const pin = String(c.pin || '').trim();
        if (!username || !password) throw new BlueLinkError('No BlueLink account is saved (Service keys > BlueLink)', 'NO_ACCOUNT');
        return { username, password, pin };
    }

    async function signIn(force) {
        const cred = credentials();
        if (token && token.username !== cred.username) token = null;
        if (!force && token && token.until - Date.now() > 60 * 1000) return { cred, token };
        const body = { username: cred.username, password: cred.password };
        let json = null;
        if (token && token.refresh && !force) {
            try {
                ({ json } = await call('Sign-in', { method: 'POST', path: `${LOGIN_API}oauth/token`, headers: baseHeaders(), body: { ...body, grant_type: 'refresh_token', refresh_token: token.refresh } }));
            } catch (_) {
                json = null;
            }
        }
        if (!json || !json.access_token) {
            ({ json } = await call('Sign-in', { method: 'POST', path: `${LOGIN_API}oauth/token`, headers: baseHeaders(), body }));
        }
        if (!json || !json.access_token) throw new BlueLinkError('Sign-in: BlueLink gave no token (check the e-mail and password)', 'AUTH', 401);
        token = {
            username: cred.username,
            access: json.access_token,
            refresh: json.refresh_token || (token && token.refresh) || null,
            until: Date.now() + (Number(json.expires_in) || 1800) * 1000,
        };
        return { cred, token };
    }

    // one retry with a fresh sign-in when the token was turned down
    async function authed(what, build) {
        for (let attempt = 0; ; attempt++) {
            const { cred, token: t } = await signIn(attempt > 0);
            const headers = { ...baseHeaders(), username: cred.username, accessToken: t.access, blueLinkServicePin: cred.pin };
            try {
                return await call(what, build(headers, cred));
            } catch (e) {
                if (e.code !== 'AUTH' || attempt > 0) throw e;
            }
        }
    }

    function vehicleHeaders(headers, vehicle) {
        return { ...headers, registrationId: vehicle.id, gen: String(vehicle.generation || '2'), vin: vehicle.vin };
    }

    async function vehicles({ fresh = false } = {}) {
        if (!fresh && enrollment && Date.now() - enrollment.at < 6 * 60 * 60 * 1000) return enrollment.list;
        const { json } = await authed('Vehicle list', (headers, cred) => ({ path: `${API}enrollment/details/${encodeURIComponent(cred.username)}`, headers }));
        const rows = (json && json.enrolledVehicleDetails) || null;
        if (!Array.isArray(rows)) throw new BlueLinkError('Vehicle list: BlueLink sent no vehicles', 'BAD_ANSWER');
        const list = rows
            .map((r) => r && r.vehicleDetails)
            .filter(Boolean)
            .map((d) => ({
                id: d.regid,
                vin: d.vin,
                name: d.nickName || d.modelCode || 'Vehicle',
                model: d.modelCode || '',
                year: d.modelYear || '',
                series: d.series || '',
                trim: d.trim || '',
                color: d.color || d.exteriorColor || '',
                engine: d.evStatus === 'E' ? 'ev' : d.evStatus === 'P' ? 'phev' : 'ice',
                generation: String(d.vehicleGeneration || '2'),
                odometer: toNum(d.odometer),
                enrolled: d.enrollmentDate || '',
                active: d.enrollmentStatus !== 'CANCELLED',
            }));
        enrollment = { at: Date.now(), list };
        return list;
    }

    /** The car's last report (refresh false) or a fresh one that wakes the car (refresh true). */
    async function status(vehicle, { refresh = false } = {}) {
        const { json } = await authed('Vehicle status', (headers) => {
            const h = vehicleHeaders(headers, vehicle);
            if (refresh) h.REFRESH = 'true';
            return { path: `${API}rcs/rvs/vehicleStatus`, headers: h };
        });
        if (!json || !json.vehicleStatus) throw new BlueLinkError('Vehicle status: BlueLink sent no status', 'BAD_ANSWER');
        return normalizeStatus(json.vehicleStatus);
    }

    /** Where the car is (Find My Car). Hyundai limits how often this may be asked. */
    async function location(vehicle) {
        const { json } = await authed('Vehicle location', (headers) => ({ path: `${API}rcs/rfc/findMyCar`, headers: vehicleHeaders(headers, vehicle) }));
        return normalizeLocation(json);
    }

    function tid(headers) {
        for (const k of ['tmstid', 'transactionid', 'xid']) {
            const hit = Object.keys(headers).find((n) => n.toLowerCase() === k);
            if (hit) return String(headers[hit]);
        }
        return null;
    }

    async function lock(vehicle, locked) {
        const { headers } = await authed(locked ? 'Lock' : 'Unlock', (h, cred) => ({
            method: 'POST',
            path: `${API}rcs/rdo/${locked ? 'off' : 'on'}`,
            headers: { ...vehicleHeaders(h, vehicle), 'APPCLOUD-VIN': vehicle.vin },
            body: { userName: cred.username, vin: vehicle.vin },
        }));
        return { transactionId: tid(headers) };
    }

    /**
     * Remote start with climate. options: { temp (°F), minutes, defrost, heating, seats: { fl, fr, rl, rr } }.
     * Temperatures outside the car's 62-82 range are sent as its LO / HI ends.
     */
    async function startClimate(vehicle, options = {}) {
        const body = climateBody(vehicle, options);
        const { headers } = await authed('Remote start', (h, cred) => ({
            method: 'POST',
            path: `${API}${vehicle.engine === 'ev' ? 'evc/fatc/start' : 'rcs/rsc/start'}`,
            headers: vehicleHeaders(h, vehicle),
            body: vehicle.engine === 'ev' ? body : { ...body, username: cred.username, vin: vehicle.id },
        }));
        return { transactionId: tid(headers), sent: body };
    }

    async function stopClimate(vehicle) {
        const { headers } = await authed('Remote stop', (h) => ({ method: 'POST', path: `${API}${vehicle.engine === 'ev' ? 'evc/fatc/stop' : 'rcs/rsc/stop'}`, headers: vehicleHeaders(h, vehicle) }));
        return { transactionId: tid(headers) };
    }

    /** One look at a sent command: 'success' | 'failed' | 'pending' | 'unknown'. */
    async function actionStatus(vehicle, transactionId) {
        if (!transactionId) return 'unknown';
        try {
            const { json } = await authed('Command status', (h, cred) => ({
                path: `${API}rmt/getRunningStatus`,
                headers: { ...vehicleHeaders(h, vehicle), tid: transactionId, login_id: cred.username, service_type: 'REMOTE_POLL' },
            }));
            const s = json && json.status;
            return s === 'SUCCESS' ? 'success' : s === 'ERROR' ? 'failed' : json ? 'pending' : 'unknown';
        } catch (e) {
            if (e.code === 'AUTH' || e.code === 'NO_ACCOUNT') throw e;
            return 'unknown';
        }
    }

    return { vehicles, status, location, lock, startClimate, stopClimate, actionStatus, signOut: () => { token = null; enrollment = null; } };
}

function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function flag(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return /^(1|true|on|open)$/i.test(String(v));
}

function clampTemp(t) {
    const n = Math.round(Number(t));
    if (!Number.isFinite(n)) return 72;
    return Math.min(TEMP_MAX, Math.max(TEMP_MIN, n));
}

function climateBody(vehicle, options) {
    const seats = options.seats || {};
    const seat = (v) => Math.max(0, Math.trunc(Number(v) || 0));
    const minutes = Math.min(30, Math.max(1, Math.trunc(Number(options.minutes) || 10)));
    const temp = clampTemp(options.temp);
    const heating = Math.max(0, Math.trunc(Number(options.heating) || 0));
    const seatInfo = { drvSeatHeatState: seat(seats.fl), astSeatHeatState: seat(seats.fr), rlSeatHeatState: seat(seats.rl), rrSeatHeatState: seat(seats.rr) };
    if (vehicle.engine === 'ev') {
        const body = { airCtrl: 1, airTemp: { value: String(temp), unit: 1 }, defrost: !!options.defrost, heating1: heating };
        if (String(vehicle.generation) === '3') Object.assign(body, { igniOnDuration: minutes, seatHeaterVentInfo: seatInfo });
        return body;
    }
    return { Ims: 0, airCtrl: 1, airTemp: { unit: 1, value: temp }, defrost: !!options.defrost, heating1: heating, igniOnDuration: minutes, seatHeaterVentInfo: seatInfo };
}

function parseTime(s) {
    if (!s) return null;
    const str = String(s);
    let t = Date.parse(str);
    if (!Number.isFinite(t)) {
        const m = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
        if (m) t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
    return Number.isFinite(t) ? t : null;
}

function normalizeLocation(json) {
    const c = json && json.coord;
    if (!c || toNum(c.lat) === null || toNum(c.lon) === null) return null;
    return { lat: toNum(c.lat), lon: toNum(c.lon), heading: toNum(json.head), speed: toNum(json.speed && json.speed.value), at: parseTime(json.time) };
}

/** BlueLink's vehicleStatus as Lapis's flat status. Distances in miles, temperatures in °F. */
function normalizeStatus(s) {
    const pick = (o, k) => (o && o[k] !== undefined ? o[k] : null);
    const door = s.doorOpen || {};
    const win = s.windowOpen || {};
    const lamp = s.tirePressureLamp || {};
    const seat = s.seatHeaterVentState || {};
    let air = pick(s.airTemp, 'value');
    if (air === 'LO') air = TEMP_MIN;
    else if (air === 'HI') air = TEMP_MAX;
    const range = toNum(pick(s.dte, 'value')) ?? toNum(pick(pick(pick((s.evStatus && s.evStatus.drvDistance && s.evStatus.drvDistance[0]) || null, 'rangeByFuel'), 'totalAvailableRange'), 'value'));
    const rangeUnit = pick(s.dte, 'unit');
    const tireLow = { fl: flag(lamp.tirePressureWarningLampFrontLeft), fr: flag(lamp.tirePressureWarningLampFrontRight), rl: flag(lamp.tirePressureWarningLampRearLeft), rr: flag(lamp.tirePressureWarningLampRearRight) };
    return {
        at: parseTime(s.dateTime),
        locked: flag(s.doorLock),
        engine: flag(s.engine),
        climate: flag(s.airCtrlOn),
        defrost: flag(s.defrost),
        setTemp: toNum(air),
        wheelHeat: flag(s.steerWheelHeat),
        rearGlassHeat: flag(s.sideBackWindowHeat),
        seats: { fl: toNum(seat.flSeatHeatState), fr: toNum(seat.frSeatHeatState), rl: toNum(seat.rlSeatHeatState), rr: toNum(seat.rrSeatHeatState) },
        fuel: toNum(s.fuelLevel),
        fuelLow: flag(s.lowFuelLight),
        range: range === null ? null : rangeUnit === 1 ? Math.round(range * 0.621371) : range,
        odometer: toNum(s.odometer),
        battery12: toNum(pick(s.battery, 'batSoc')),
        doors: { fl: flag(door.frontLeft), fr: flag(door.frontRight), rl: flag(door.backLeft), rr: flag(door.backRight) },
        windows: { fl: flag(win.frontLeft), fr: flag(win.frontRight), rl: flag(win.backLeft), rr: flag(win.backRight) },
        trunk: flag(s.trunkOpen),
        hood: flag(s.hoodOpen),
        tireLow: { ...tireLow, any: flag(lamp.tirePressureWarningLampAll) || Object.values(tireLow).some(Boolean) },
        washerLow: flag(s.washerFluidStatus),
        brakeFluidLow: flag(s.breakOilStatus),
        keyBatteryLow: flag(s.smartKeyBatteryWarning),
        location: normalizeLocation(s.vehicleLocation),
    };
}

module.exports = {
    BlueLinkError,
    createClient,
    normalizeStatus,
    normalizeLocation,
    climateBody,
    TEMP_MIN,
    TEMP_MAX,
    _setRequest(fn) {
        requestImpl = fn || null;
    },
};
