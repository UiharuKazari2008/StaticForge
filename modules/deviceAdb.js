/**
 * ADB on port 5555 for ActiveSync phones (Yozora #818): screenshots of every screen (cover, inner,
 * DeX / external) and program installs, run from this server.
 *
 * Yukimi (Nov 13 2026): ADB over 5555 goes first when it is present and detected (it is the most
 * reliable path), Shizuku in the phone's app second; this server is the adb host.
 *
 * Detection: a phone's ActiveSync sockets carry the address it connects from (websocket.js
 * clientInfo.clientIP: its LAN address at home, its VPN address away). Private addresses only are
 * tried, plus the last one that worked; `adb connect <ip>:5555`, then the phone's model must match
 * the ActiveSync device's, so a reused address never reaches another phone. The server's adb key
 * needs one "Always allow" on each phone: until then the state is "unauthorized".
 *
 *   status(deviceId)                       { state, serial, address, tried, checkedAt, error, allow, autoRestore }
 *     state: off (Allow ADB unchecked) | unknown | ready | unauthorized | unreachable | mismatch | error
 *   detect(gr, deviceId, { force })        connects and refreshes status (at most once a minute unless forced)
 *   displays(gr, deviceId)                 [{ id, kind: inner | cover | main | external, name, width, height, on }]
 *   screenshot(gr, deviceId, display)      PNG Buffer; display = a kind, a display id, or omitted (main / inner)
 *   install(gr, deviceId, apkFile)         { state: 'installed', via: 'adb' } (adb install -r)
 *   installOnPhone(gr, deviceId, root, p)  the same for an .apk already on the phone (pm install)
 *   settings(gr, deviceId, patch)          { allow, autoRestore, shizukuAutoStart, shizukuRecover, preferred, features } (Android Bridge / Device Center)
 *     features: the Allowed Features (#820); screenshots off = Device Center shows the wallpapers
 *
 * adb: env DREAMSCAPE_ADB, else ~/.local/bin/adb (platform-tools in ~/.local/share), else PATH.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { isPrivateOrLinkLocalOrUla, normalizeIp } = require('./clientAddress');

const PORT = 5555;
const DETECT_EVERY_MS = 60000;
const CONNECT_TIMEOUT_MS = 8000;
const SHELL_TIMEOUT_MS = 15000;
const SHOT_TIMEOUT_MS = 20000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SHOT_BYTES = 40 * 1024 * 1024;

const states = new Map();   // deviceId -> { state, serial, address, checkedAt, error, model }
const inFlight = new Map(); // deviceId -> Promise of a detect
let storePath = null;
let store = null;           // { [deviceId]: { allow, autoRestore, address, serial } }
let adbPath = null;

function fail(code, message) {
    return Object.assign(new Error(message), { code });
}

function adbBinary() {
    if (adbPath) return adbPath;
    const local = path.join(os.homedir(), '.local', 'bin', 'adb');
    adbPath = process.env.DREAMSCAPE_ADB || (fs.existsSync(local) ? local : 'adb');
    return adbPath;
}

/** adb with a timeout; resolves { stdout, stderr } (stdout a Buffer when binary), rejects with code ADB. */
function adb(args, { timeout = SHELL_TIMEOUT_MS, binary = false, maxBuffer = 4 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
        execFile(adbBinary(), args, { timeout, maxBuffer, encoding: binary ? 'buffer' : 'utf8', windowsHide: true }, (err, stdout, stderr) => {
            const errText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '');
            if (err) {
                const text = (errText || (Buffer.isBuffer(stdout) ? '' : String(stdout || '')) || err.message).trim();
                reject(Object.assign(new Error(text || 'adb failed'), { code: err.code === 'ENOENT' ? 'NO_ADB' : (err.killed ? 'TIMEOUT' : 'ADB') }));
                return;
            }
            resolve({ stdout, stderr: errText });
        });
    });
}

// ---------------------------------------------------------------- per-device settings

function loadStore(globalResources) {
    if (store) return store;
    const dir = globalResources && typeof globalResources.getPath === 'function'
        ? globalResources.getPath('databases')
        : path.resolve(__dirname, '..', '.cache');
    storePath = path.join(dir, 'device-adb.json');
    try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')) || {}; } catch (_) { store = {}; }
    return store;
}

function saveStore() {
    if (!storePath || !store) return;
    try {
        const tmp = `${storePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
        fs.renameSync(tmp, storePath);
    } catch (err) {
        console.warn('[deviceAdb] could not save settings:', err.message);
    }
}

// Android Bridge > Advanced Tools (#820): Allowed Features; the phone has the last word, the server checks
// before it relays. Screenshots was its own switch before (#818): it is the screenshots feature now.
const FEATURES = ['radioRead', 'radioModify', 'install', 'screenshots', 'castRead', 'castInteract', 'commands', 'portForward', 'filesRead', 'filesWrite'];
const FEATURE_DEFAULTS = { radioRead: true, radioModify: false, install: true, screenshots: true, castRead: false, castInteract: false, commands: false, portForward: false, filesRead: false, filesWrite: false };

function entry(globalResources, deviceId) {
    const s = loadStore(globalResources);
    if (!s[deviceId]) s[deviceId] = { allow: true, autoRestore: false };
    return s[deviceId];
}

function features(e) {
    const f = Object.assign({}, FEATURE_DEFAULTS, e.features || {});
    if (e.screenshots === false && !(e.features && 'screenshots' in e.features)) f.screenshots = false;
    return f;
}

function settings(globalResources, deviceId, patch) {
    const e = entry(globalResources, deviceId);
    if (patch && typeof patch === 'object') {
        for (const k of ['allow', 'autoRestore', 'shizukuAutoStart', 'shizukuRecover']) if (typeof patch[k] === 'boolean') e[k] = patch[k];
        if (patch.preferred === 'adb' || patch.preferred === 'shizuku') e.preferred = patch.preferred;
        // the older single switch
        if (typeof patch.screenshots === 'boolean') e.features = Object.assign(features(e), { screenshots: patch.screenshots });
        if (patch.features && typeof patch.features === 'object') {
            const f = features(e);
            for (const k of FEATURES) if (typeof patch.features[k] === 'boolean') f[k] = patch.features[k];
            e.features = f;
        }
        delete e.screenshots;
        saveStore();
        if (e.allow === false) states.set(deviceId, { state: 'off', checkedAt: Date.now() });
        else if ((states.get(deviceId) || {}).state === 'off') states.delete(deviceId);
    }
    const f = features(e);
    return {
        allow: e.allow !== false,
        autoRestore: !!e.autoRestore,
        shizukuAutoStart: !!e.shizukuAutoStart,
        shizukuRecover: !!e.shizukuRecover,
        preferred: e.preferred === 'shizuku' ? 'shizuku' : 'adb',
        features: f,
        // kept for Device Center and older pages
        screenshots: f.screenshots
    };
}

/** May the server relay this feature for the phone? (Use ADB on, and the feature allowed.) */
function allowed(globalResources, deviceId, feature) {
    const s = settings(globalResources, deviceId);
    return s.allow && !!s.features[feature];
}

// ---------------------------------------------------------------- detection

function activeSync() { return require('./activeSync'); }

/** Private addresses a phone's ActiveSync sockets come from, newest first, then the last good one. */
function candidates(globalResources, wsServer, deviceId) {
    const out = [];
    const add = (ip) => {
        const n = normalizeIp(String(ip || ''));
        if (n && isPrivateOrLinkLocalOrUla(n) && !n.startsWith('127.') && n !== '::1' && !out.includes(n)) out.push(n);
    };
    try { for (const ip of activeSync().deviceAddresses(globalResources, wsServer, deviceId)) add(ip); } catch (_) { /* no sockets */ }
    const e = entry(globalResources, deviceId);
    if (e.address) add(e.address);
    return out;
}

function status(globalResources, deviceId) {
    const st = states.get(deviceId) || { state: 'unknown' };
    const set = settings(globalResources, deviceId);
    if (!set.allow) return { state: 'off', ...set };
    return { state: st.state, serial: st.serial || null, address: st.address || null, tried: st.tried || [], checkedAt: st.checkedAt || null, error: st.error || null, ...set };
}

async function probe(serial, wantModel) {
    let state;
    try { state = (await adb(['-s', serial, 'get-state'], { timeout: 5000 })).stdout.trim(); } catch (err) {
        if (/unauthorized/i.test(err.message)) return { state: 'unauthorized', error: 'Allow USB debugging for this server on the phone (Always allow).' };
        return { state: 'unreachable', error: err.message };
    }
    if (state !== 'device') return { state: state === 'unauthorized' ? 'unauthorized' : 'unreachable', error: state };
    let model = '';
    try { model = (await adb(['-s', serial, 'shell', 'getprop', 'ro.product.model'], { timeout: 5000 })).stdout.trim(); } catch (_) { model = ''; }
    // a reused address must not reach another phone: the ActiveSync model ("SM-F966U") or the
    // phone's own device name must agree when both are known
    if (wantModel && model && !wantModel.toLowerCase().includes(model.toLowerCase()) && !model.toLowerCase().includes(wantModel.toLowerCase())) {
        return { state: 'mismatch', model, error: `${serial} is a ${model}, not this ${wantModel}.` };
    }
    return { state: 'ready', model };
}

async function detectNow(globalResources, wsServer, deviceId) {
    const set = settings(globalResources, deviceId);
    if (!set.allow) { states.set(deviceId, { state: 'off', checkedAt: Date.now() }); return status(globalResources, deviceId); }
    let wantModel = '';
    try {
        const d = activeSync().deviceRow(globalResources, deviceId);
        wantModel = (d && d.model) || '';
    } catch (_) { wantModel = ''; }
    const list = candidates(globalResources, wsServer, deviceId);
    let best = { state: list.length ? 'unreachable' : 'unknown', error: list.length ? 'Nothing answers on port 5555.' : 'No address known for this phone yet.' };
    for (const ip of list) {
        const serial = ip.includes(':') ? `[${ip}]:${PORT}` : `${ip}:${PORT}`;
        try { await adb(['connect', serial], { timeout: CONNECT_TIMEOUT_MS }); } catch (_) { /* get-state says */ }
        const r = await probe(serial, wantModel);
        r.serial = serial;
        r.address = ip;
        if (r.state === 'ready') { best = r; break; }
        // unauthorized beats unreachable: the phone is there, it only needs the tap
        if (r.state === 'unauthorized' || (r.state === 'mismatch' && best.state !== 'unauthorized')) best = r;
        else try { await adb(['disconnect', serial], { timeout: 4000 }); } catch (_) { /* gone already */ }
    }
    best.checkedAt = Date.now();
    best.tried = list;
    states.set(deviceId, best);
    if (best.state === 'ready') {
        const e = entry(globalResources, deviceId);
        if (e.address !== best.address || e.serial !== best.serial) { e.address = best.address; e.serial = best.serial; saveStore(); }
    }
    return status(globalResources, deviceId);
}

function wsServerOf(globalResources, wsServer) {
    if (wsServer) return wsServer;
    // getWebSocketServer throws until the socket server is set (the first seconds after a start)
    try { return globalResources && typeof globalResources.getWebSocketServer === 'function' ? globalResources.getWebSocketServer() : null; } catch (_) { return null; }
}

/** Connects (once a minute at most unless forced) and returns status(). */
function detect(globalResources, deviceId, { force = false, wsServer = null } = {}) {
    const st = states.get(deviceId);
    if (!force && st && st.checkedAt && Date.now() - st.checkedAt < DETECT_EVERY_MS) return Promise.resolve(status(globalResources, deviceId));
    if (inFlight.has(deviceId)) return inFlight.get(deviceId);
    const p = detectNow(globalResources, wsServerOf(globalResources, wsServer), deviceId)
        .catch((err) => {
            states.set(deviceId, { state: err.code === 'NO_ADB' ? 'error' : 'unreachable', error: err.message, checkedAt: Date.now() });
            return status(globalResources, deviceId);
        })
        .finally(() => inFlight.delete(deviceId));
    inFlight.set(deviceId, p);
    return p;
}

/** A phone came online (ActiveSync hello): look for it in the background. */
function noteOnline(globalResources, wsServer, deviceId) {
    const st = states.get(deviceId);
    // a phone that was ready stays so until a command fails; others are tried again now
    if (st && st.state === 'ready') return;
    setTimeout(() => {
        detect(globalResources, deviceId, { force: true, wsServer }).then((s) => {
            if (s.state === 'ready') console.log(`📱 ADB ready for ${deviceId.slice(0, 8)}… at ${s.serial}`);
            try { activeSync().touchDevice(globalResources, wsServer, deviceId); } catch (_) { /* no broadcast */ }
        });
    }, 1500).unref?.();
}

async function readySerial(globalResources, deviceId) {
    let st = await detect(globalResources, deviceId);
    if (st.state !== 'ready') st = await detect(globalResources, deviceId, { force: true });
    if (st.state !== 'ready') throw fail(st.state === 'off' ? 'ADB_OFF' : 'NO_ADB_DEVICE', st.error || `ADB is ${st.state} for this phone.`);
    return st.serial;
}

/** A command on a ready phone; a dropped link marks it for detection again and retries once. */
async function onPhone(globalResources, deviceId, fn) {
    const serial = await readySerial(globalResources, deviceId);
    try {
        return await fn(serial);
    } catch (err) {
        if (!/device .*not found|offline|closed|no devices|protocol fault|unauthorized/i.test(err.message)) throw err;
        states.delete(deviceId);
        const again = await readySerial(globalResources, deviceId);
        return fn(again);
    }
}

// ---------------------------------------------------------------- displays and screenshots

/**
 * `dumpsys SurfaceFlinger --display-id` gives the physical ids screencap -d takes; `dumpsys display`
 * gives each one's size, state and type (uniqueId "local:<id>" for built-in panels).
 */
function parseDisplays(sfText, dispText) {
    const out = [];
    for (const line of String(sfText || '').split('\n')) {
        const m = line.match(/^Display\s+(\d+)\s+\(HWC display (\d+)\):(.*)$/);
        if (!m) continue;
        const name = (m[3].match(/displayName="([^"]*)"/) || [])[1] || '';
        out.push({ id: m[1], hwc: Number(m[2]), name, width: null, height: null, on: null, type: null });
    }
    // DisplayDeviceInfo{"Built-in Screen": uniqueId="local:4630946213010294401", 1856 x 2160, ... type INTERNAL ... state ON ...}
    const re = /DisplayDeviceInfo\{"([^"]*)":\s*uniqueId="([^"]*)",\s*(\d+)\s*x\s*(\d+)([^}]*)\}/g;
    let m;
    while ((m = re.exec(String(dispText || '')))) {
        const uid = m[2];
        const rest = m[5];
        const local = uid.match(/^local:(\d+)$/);
        const d = local ? out.find((x) => x.id === local[1]) : null;
        if (!d) continue;
        d.width = Number(m[3]);
        d.height = Number(m[4]);
        if (!d.name) d.name = m[1];
        const type = (rest.match(/type\s+([A-Z_]+)/) || [])[1] || null;
        const state = (rest.match(/state\s+([A-Z_]+)/) || [])[1] || null;
        d.type = type;
        d.on = state ? state === 'ON' : null;
    }
    classify(out);
    return out.map(({ id, kind, name, width, height, on }) => ({ id, kind, name, width, height, on }));
}

/**
 * Kinds: the phone's own panels are "Built-in Screen" (Samsung prints no type in dumpsys display:
 * the Fold's NexDock came out as its cover by HWC order), or type INTERNAL; anything else (DeX's
 * monitor or dock) is external. Of two built-in panels the larger is the inner screen and the
 * smaller the cover; one alone is "main". Also run on a phone's own list (its older parser).
 */
function classify(list) {
    const builtIn = (d) => d.type === 'INTERNAL' || (d.type !== 'EXTERNAL' && /built-?in/i.test(d.name || '')) || (!d.type && !d.name && d.hwc === 0);
    const internal = list.filter(builtIn);
    for (const d of list) d.kind = internal.includes(d) ? null : 'external';
    if (internal.length >= 2) {
        const area = (d) => (d.width || 0) * (d.height || 0);
        const sorted = internal.slice().sort((a, b) => area(b) - area(a) || (a.hwc || 0) - (b.hwc || 0));
        sorted[0].kind = 'inner';
        sorted.slice(1).forEach((d, i) => { d.kind = i === 0 ? 'cover' : 'internal'; });
    } else if (internal.length === 1) internal[0].kind = 'main';
    return list;
}

// ---------------------------------------------------------------- from the phone's own side (#818)

/*
 * Yukimi (Nov 13): ADB runs from the phone's localhost. The app (DSApp LocalAdb.kt) is an ADB client
 * of its own adbd at 127.0.0.1:5555 and answers screen.displays / screen.shot / status.adb over
 * ActiveSync, wherever the phone is. A screenshot comes back as an upload: the server hands the
 * phone a one-time token, the phone posts the PNG to /api/activesync/screen/<id>/shot/<token>.
 * The server's own dial (above) is the fallback for a phone without those ops.
 */
const crypto = require('crypto');
const shotWaits = new Map(); // token -> { deviceId, resolve, reject, timer }
const PHONE_FALLBACK = new Set(['UNKNOWN_OP', 'NOT_CONNECTED', 'OFFLINE', 'NO_SOCKET', 'NOT_ANSWERED', 'UNSUPPORTED', 'NOT_ONLINE', 'NOT_LISTENING', 'UNAUTHORIZED']);

function phoneCall(globalResources, deviceId, op, args, timeoutMs) {
    const as = activeSync();
    const ws = wsServerOf(globalResources, null);
    if (!as.deviceOnline(globalResources, ws, deviceId)) return Promise.reject(fail('NOT_ONLINE', 'The phone is not connected.'));
    return as.serverCall(globalResources, ws, deviceId, op, args || {}, { timeoutMs: timeoutMs || 20000 });
}

/** The phone's own ADB view: { listening, authorized, wifi, shizuku, restore, ... } or null. */
async function phoneStatus(globalResources, deviceId) {
    try { return await phoneCall(globalResources, deviceId, 'status.adb', {}, 6000); } catch (_) { return null; }
}

async function displays(globalResources, deviceId) {
    try {
        const r = await phoneCall(globalResources, deviceId, 'screen.displays', {}, 20000);
        if (r && Array.isArray(r.displays)) return classify(r.displays.map((d) => Object.assign({}, d)));
    } catch (err) {
        if (!PHONE_FALLBACK.has(err.code)) throw err;
    }
    return onPhone(globalResources, deviceId, async (serial) => {
        const sf = await adb(['-s', serial, 'shell', 'dumpsys', 'SurfaceFlinger', '--display-id']);
        let disp = { stdout: '' };
        try { disp = await adb(['-s', serial, 'shell', 'dumpsys', 'display'], { maxBuffer: 16 * 1024 * 1024 }); } catch (_) { /* ids only */ }
        return parseDisplays(sf.stdout, disp.stdout);
    });
}

/** The phone posts a screenshot it was asked for (its own session, a token it was given). */
function takeShot(deviceId, token, png) {
    const w = shotWaits.get(token);
    if (!w || w.deviceId !== deviceId) return false;
    shotWaits.delete(token);
    clearTimeout(w.timer);
    w.resolve(png);
    return true;
}

async function phoneShot(globalResources, deviceId, displayId) {
    const token = crypto.randomBytes(16).toString('hex');
    const got = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { shotWaits.delete(token); reject(fail('TIMEOUT', 'The phone did not send the screenshot.')); }, 40000);
        shotWaits.set(token, { deviceId, resolve, reject, timer });
    });
    try {
        await phoneCall(globalResources, deviceId, 'screen.shot', { display: displayId, token }, 35000);
    } catch (err) {
        const w = shotWaits.get(token);
        if (w) { clearTimeout(w.timer); shotWaits.delete(token); }
        throw err;
    }
    return got;
}

function pickDisplay(list, want) {
    const w = String(want || '').toLowerCase();
    if (!w) return list.find((d) => d.kind === 'inner' && d.on !== false) || list.find((d) => d.kind === 'main') || list.find((d) => d.on !== false) || list[0] || null;
    if (/^\d+$/.test(w)) return list.find((d) => d.id === w) || null;
    if (w === 'dex' || w === 'laptop' || w === 'monitor') return list.find((d) => d.kind === 'external') || null;
    return list.find((d) => d.kind === w) || null;
}

/** One screen as PNG: { png, display }. */
async function screenshot(globalResources, deviceId, display) {
    if (!allowed(globalResources, deviceId, 'screenshots')) throw fail('SCREENSHOTS_OFF', 'Screenshots are not an allowed feature for this phone (Android Bridge > Advanced Tools).');
    const list = await displays(globalResources, deviceId);
    const d = pickDisplay(list, display);
    if (!d) throw fail('NO_DISPLAY', display ? `The phone has no ${display} screen right now.` : 'The phone reports no screen.');
    let png = null;
    try {
        png = await phoneShot(globalResources, deviceId, d.id);
    } catch (err) {
        if (!PHONE_FALLBACK.has(err.code)) throw err;
        png = await onPhone(globalResources, deviceId, async (serial) => {
            const args = ['-s', serial, 'exec-out', 'screencap'];
            if (list.length > 1) args.push('-d', d.id);
            args.push('-p');
            const r = await adb(args, { binary: true, timeout: SHOT_TIMEOUT_MS, maxBuffer: MAX_SHOT_BYTES });
            return r.stdout;
        });
    }
    if (!png || png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50) {
        throw fail('SHOT_FAILED', d.on === false ? `The ${d.kind} screen is off.` : 'The phone sent no picture.');
    }
    return { png, display: d };
}

// ---------------------------------------------------------------- installs

function installResult(text) {
    const t = String(text || '');
    if (/\bSuccess\b/.test(t)) return { state: 'installed', via: 'adb' };
    const code = (t.match(/\[(INSTALL_[A-Z_]+)/) || t.match(/(INSTALL_[A-Z_]+)/) || [])[1] || 'INSTALL_FAILED';
    throw fail(code, t.trim().split('\n').pop() || 'The install failed.');
}

/** An .apk on this server, installed over ADB (replacing an older version). */
async function install(globalResources, deviceId, apkFile) {
    if (!fs.existsSync(apkFile)) throw fail('NOT_FOUND', 'The program file is gone.');
    return onPhone(globalResources, deviceId, async (serial) => {
        try {
            const r = await adb(['-s', serial, 'install', '-r', apkFile], { timeout: INSTALL_TIMEOUT_MS });
            return installResult(`${r.stdout}\n${r.stderr}`);
        } catch (err) {
            if (err.code && String(err.code).startsWith('INSTALL_')) throw err;
            return installResult(err.message);
        }
    });
}

/** An .apk already on the phone (ActiveSync storage root "internal" = /sdcard). */
async function installOnPhone(globalResources, deviceId, root, p) {
    const base = { internal: '/sdcard', sdcard: '/sdcard' }[String(root || 'internal')];
    if (!base) throw fail('UNSUPPORTED_ROOT', `ADB cannot install from ${root}.`);
    const rel = String(p || '').replace(/^\/+/, '');
    if (!rel || rel.includes('..')) throw fail('BAD_PATH', 'Bad path.');
    const full = `${base}/${rel}`;
    return onPhone(globalResources, deviceId, async (serial) => {
        const quoted = `'${full.replace(/'/g, `'\\''`)}'`;
        const r = await adb(['-s', serial, 'shell', `pm install -r ${quoted}`], { timeout: INSTALL_TIMEOUT_MS });
        return installResult(`${r.stdout}\n${r.stderr}`);
    });
}

/** Remote Commands (#820): { output, error, exitCode } of one shell command on the phone. */
async function shell(globalResources, deviceId, command) {
    const cmd = String(command || '').trim();
    if (!cmd) throw fail('BAD_REQUEST', 'No command.');
    if (cmd.length > 8000) throw fail('BAD_REQUEST', 'The command is too long.');
    if (!allowed(globalResources, deviceId, 'commands')) throw fail('NOT_ALLOWED', 'Remote Commands is not an allowed feature for this phone (Android Bridge > Advanced Tools).');
    return phoneCall(globalResources, deviceId, 'device.adbShell', { command: cmd }, 60000);
}

/** device_shell for agents: { device?, command } -> the phone's answer (device as in device_screenshot). */
async function agentShell(globalResources, input = {}) {
    const all = activeSync().list(globalResources, wsServerOf(globalResources, null)).devices;
    const want = String(input.device || '').trim().toLowerCase();
    const dev = want ? (all.find((d) => d.deviceId === want) || all.find((d) => String(d.name || '').toLowerCase() === want)) : (all.filter((d) => d.online).length === 1 ? all.find((d) => d.online) : null);
    if (!dev) return { success: false, code: 'CHOOSE_DEVICE', devices: all.map((d) => ({ deviceId: d.deviceId, name: d.name, online: d.online })) };
    return { success: true, device: dev.name, ...(await shell(globalResources, dev.deviceId, input.command)) };
}

// ---------------------------------------------------------------- agents (MCP device_screenshot)

/**
 * device_screenshot for agents: { device?, display?, detect? }. device = an ActiveSync device id or
 * name (any case, "Galaxy Fold"); omitted with one phone online = that phone. display = inner |
 * cover | external (dex) | main | all | a display id; omitted = the inner / main screen. Answers
 * { meta, images: [{ mimeType, bytes }] } with JPEGs at most 1600 px on the long side; with
 * nothing to show (no device given among several, ADB not ready) meta lists the phones and their
 * ADB states.
 */
async function agentScreenshot(globalResources, input = {}) {
    const all = activeSync().list(globalResources, wsServerOf(globalResources, null)).devices;
    const brief = (d) => ({ deviceId: d.deviceId, name: d.name, model: d.model, online: d.online, partner: d.partner, adb: status(globalResources, d.deviceId), phoneAdb: d.phoneAdb || undefined });
    const want = String(input.device || input.deviceId || '').trim().toLowerCase();
    let dev = null;
    if (want) dev = all.find((d) => d.deviceId === want) || all.find((d) => String(d.name || '').toLowerCase() === want) || all.find((d) => String(d.model || '').toLowerCase() === want) || null;
    else {
        const online = all.filter((d) => d.online);
        if (online.length === 1) dev = online[0];
    }
    if (!dev) return { meta: { success: false, code: want ? 'NO_SUCH_DEVICE' : 'CHOOSE_DEVICE', error: want ? `No ActiveSync device called ${input.device}.` : 'Name a device.', devices: all.map(brief) }, images: [] };
    if (!allowed(globalResources, dev.deviceId, 'screenshots')) return { meta: { success: false, code: 'SCREENSHOTS_OFF', device: brief(dev), hint: 'Screenshots are turned off for this phone (Device Center / Android Bridge).' }, images: [] };
    const local = dev.online ? await phoneStatus(globalResources, dev.deviceId) : null;
    const st = local && local.listening ? { state: 'phone' } : await detect(globalResources, dev.deviceId, { force: !!input.detect });
    if (st.state !== 'ready' && st.state !== 'phone') return { meta: { success: false, code: 'ADB_NOT_READY', device: brief(dev), hint: st.state === 'unauthorized' ? 'Tap Always allow for this server on the phone.' : st.state === 'unreachable' ? 'ADB is not listening on 5555 where the phone connects from (Wi-Fi or VPN).' : undefined }, images: [] };
    const list = await displays(globalResources, dev.deviceId);
    const which = String(input.display || '').toLowerCase() === 'all' ? list.filter((d) => d.on !== false) : [pickDisplay(list, input.display)].filter(Boolean);
    if (!which.length) return { meta: { success: false, code: 'NO_DISPLAY', device: brief(dev), displays: list }, images: [] };
    const sharp = require('sharp');
    const images = [];
    const shots = [];
    for (const d of which) {
        try {
            const { png } = await screenshot(globalResources, dev.deviceId, d.id);
            const bytes = await sharp(png).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
            images.push({ mimeType: 'image/jpeg', bytes });
            shots.push({ display: d.kind, id: d.id, width: d.width, height: d.height });
        } catch (err) {
            shots.push({ display: d.kind, id: d.id, error: err.message });
        }
    }
    return { meta: { success: images.length > 0, device: brief(dev), displays: list, shots }, images };
}

// ---------------------------------------------------------------- HTTP

/*
 *   GET  /api/activesync/adb/:deviceId                 admin or the phone itself: status() (?detect=1 looks now)
 *   PUT  /api/activesync/adb/:deviceId/settings        admin or the phone itself: { allow, autoRestore, screenshots }
 *   GET  /api/activesync/adb/:deviceId/displays        admin: displays()
 *   GET  /api/activesync/screen/:deviceId/shot         admin: image/png of ?display=inner|cover|external|main|<id>
 */
function mount(app, authMiddleware, globalResources) {
    const auth = authMiddleware || ((req, res, next) => next());
    const as = () => activeSync();
    const ws = () => wsServerOf(globalResources, null);
    const refuse = (res, status, code, error) => { if (!res.headersSent) res.status(status).json({ success: false, code, error }); };
    const idOf = (req, res) => {
        const id = String(req.params.deviceId || '').toLowerCase();
        if (!as().isPeerId(id)) { refuse(res, 400, 'BAD_REQUEST', 'Bad device id.'); return null; }
        return id;
    };
    const isAdmin = (req) => req.userType === 'admin';
    const isPhone = (req, id) => as().isDeviceSession(globalResources, ws(), id, req.sessionId || (req.session && req.session.id));
    const statusOf = (code) => ({ NOT_ALLOWED: 409, BAD_REQUEST: 400, SCREENSHOTS_OFF: 409, ADB_OFF: 409, NO_ADB_DEVICE: 409, NO_DISPLAY: 404, SHOT_FAILED: 502, NO_ADB: 503, TIMEOUT: 504 })[code] || 500;

    app.get('/api/activesync/adb/:deviceId', auth, async (req, res) => {
        const id = idOf(req, res);
        if (!id) return;
        if (!isAdmin(req) && !isPhone(req, id)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const st = req.query.detect ? await detect(globalResources, id, { force: true }) : status(globalResources, id);
        res.json({ success: true, adb: st });
    });

    app.put('/api/activesync/adb/:deviceId/settings', auth, async (req, res) => {
        const id = idOf(req, res);
        if (!id) return;
        if (!isAdmin(req) && !isPhone(req, id)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        settings(globalResources, id, req.body || {});
        const st = status(globalResources, id).allow ? await detect(globalResources, id, { force: true }) : status(globalResources, id);
        try { as().touchDevice(globalResources, ws(), id); } catch (_) { /* no broadcast */ }
        res.json({ success: true, adb: st });
    });

    // Check Now from a computer: the phone restores 5555 / starts Shizuku as Check Now on it does
    app.post('/api/activesync/adb/:deviceId/check', auth, async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const id = idOf(req, res);
        if (!id) return;
        try { res.json({ success: true, phone: await phoneCall(globalResources, id, 'device.adbRestore', { force: true }, 60000) }); } catch (err) { refuse(res, statusOf(err.code), err.code || 'ERROR', err.message); }
    });

    // Remote Commands (#820): one adb shell command on the phone, through its own local ADB
    app.post('/api/activesync/adb/:deviceId/shell', auth, async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const id = idOf(req, res);
        if (!id) return;
        try { res.json({ success: true, ...(await shell(globalResources, id, req.body && req.body.command)) }); } catch (err) { refuse(res, statusOf(err.code), err.code || 'ERROR', err.message); }
    });

    app.get('/api/activesync/adb/:deviceId/displays', auth, async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const id = idOf(req, res);
        if (!id) return;
        try { res.json({ success: true, displays: await displays(globalResources, id) }); } catch (err) { refuse(res, statusOf(err.code), err.code || 'ERROR', err.message); }
    });

    // the phone answers screen.shot: the PNG for the token it was given (its own session only)
    app.post('/api/activesync/screen/:deviceId/shot/:token', auth, (req, res) => {
        const id = idOf(req, res);
        if (!id) return;
        if (!isPhone(req, id)) { refuse(res, 403, 'NOT_DEVICE', 'Only the device itself sends its screen.'); return; }
        const parts = [];
        let size = 0;
        req.on('data', (c) => { size += c.length; if (size > MAX_SHOT_BYTES) { req.destroy(); return; } parts.push(c); });
        req.on('end', () => {
            const png = Buffer.concat(parts);
            if (!takeShot(id, String(req.params.token || ''), png)) { refuse(res, 410, 'GONE', 'Nobody is waiting for this screenshot.'); return; }
            res.json({ success: true });
        });
    });

    app.get('/api/activesync/screen/:deviceId/shot', auth, async (req, res) => {
        if (!isAdmin(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const id = idOf(req, res);
        if (!id) return;
        try {
            const { png, display } = await screenshot(globalResources, id, req.query.display);
            res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Display-Kind': display.kind || '', 'X-Display-Id': display.id });
            res.end(png);
        } catch (err) {
            refuse(res, statusOf(err.code), err.code || 'ERROR', err.message);
        }
    });
}

function resetForTests() {
    states.clear();
    inFlight.clear();
    store = null;
    storePath = null;
}

module.exports = {
    PORT,
    adbBinary,
    status,
    detect,
    noteOnline,
    displays,
    screenshot,
    install,
    installOnPhone,
    settings,
    allowed,
    FEATURES,
    parseDisplays,
    pickDisplay,
    agentScreenshot,
    agentShell,
    shell,
    phoneStatus,
    takeShot,
    mount,
    resetForTests
};
