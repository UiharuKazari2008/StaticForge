/**
 * QuickCast (Yozora #734): the server side of the AmusementVISION QuickCast program (apps/quickcast),
 * which puts a cabinet on YouTube live in one click through OBS Studio on Ruiko.
 *
 * OBS is driven over obs-websocket v5 (ws://<host>:4455). The browser never talks to OBS: every
 * request goes through here, and the client can only name a cabinet from config.json, never a scene,
 * a URL or a request type.
 *
 * Going live (Yukimi's choice, #734): OBS's own YouTube account (profile Standard60) refuses a remote
 * Start Streaming until Manage Broadcast is clicked on Ruiko, so QuickCast uses its own OBS profile
 * ("QuickCast", a copy of Standard60 without the account) and YouTube's persistent stream key. The key
 * lives only in config.json here (0600, never committed, never sent to the client) and is written
 * into the profile's stream settings right before each start.
 *
 * Files, in the app's data dir (.cache/packages/.data/quickcast/):
 *   config.json   { obs: { host, port, password }, profile, collection,
 *                   youtube: { streamKey, server, watchUrl },
 *                   cabinets: [{ id, name, scene, icon, short }],
 *                   launch: { ssh, task },
 *                   muxes: { "<NDI machine>": { host, port, password } } }   every field optional (DEFAULTS below)
 *
 * When OBS is not running, prepare() starts it with the on-demand Ruiko task launch.task (no logon
 * trigger; Yukimi OK'd it), run over SSH (launch.ssh, a Host in ~/.ssh/config).
 *
 * The connection stays open while a client polls (status / preview); it closes LEASE_MS after the
 * last poll. Volume meters (InputVolumeMeters, ~20 Hz) are held as peaks between status reads.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const WebSocket = require('ws');
const yt = require('./quickcastYoutube');
const xlink = require('./xlink');
const diag = require('./quickcastDiag');
const avOsd = require('./avOsd');

const DATA_DIR = process.env.QUICKCAST_DATA_DIR || path.join(__dirname, '..', '.cache', 'packages', '.data', 'quickcast');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
    obs: { host: '192.168.100.12', port: 4455, password: '' },
    profile: 'QuickCast',
    collection: 'Remote Play',
    youtube: { streamKey: '', server: 'rtmps://a.rtmps.youtube.com:443/live2', service: 'YouTube - RTMPS', watchUrl: '' },
    cabinets: [
        { id: 'chuni', name: 'Chunithm', scene: 'Chuni', icon: 'chuni', short: 'CHU' },
        { id: 'wacca', name: 'WACCA', scene: 'WACCA', icon: 'wacca', short: 'WAC' },
        { id: 'nost', name: 'Nostalgia', scene: 'Nosta', icon: 'nost', short: 'NOS' },
        { id: 'h2h', name: 'Chunithm H2H', scene: 'Chuni H2H', icon: 'h2h', short: 'H2H', xlink: 'chuni' }
    ],
    launch: { ssh: 'ruiko', task: '\\AmusementVISION\\QuickCast OBS', stopTask: '\\AmusementVISION\\QuickCast OBS Stop' },
    // cabinet mixer / muxer PCs by NDI machine name, for the INPUT diagnostics row (quickcastDiag)
    muxes: { 'PLG-EAST-1': { host: '192.168.100.16', port: 4455, password: '' } },
    // the boxes as hardware units: the satellite's unit name, and per unit (by name) overrides of
    // { maker, line, model, kind, theme } over UNIT_DEFAULTS
    satellite: { name: 'RUIKO' },
    units: {},
    // where the boxes' OSD browser sources load the OSD page from (avOsd.js): this server on the LAN
    osd: { baseUrl: 'http://192.168.100.250:9220' }
};

const CONNECT_TIMEOUT_MS = 4000;
const REQUEST_TIMEOUT_MS = 10000;
const LEASE_MS = 60000;
const LAUNCH_WAIT_MS = 60000;
const SWITCH_WAIT_MS = 20000;
const START_WAIT_MS = 15000;
const AUDIO_SET_TTL_MS = 5000;
const NOT_READY_WAIT_MS = 45000;
const METER_WINDOW_MS = 300; // meter readings kept for every reader (~20 Hz events)
// obs-websocket EventSubscription: General | Config | Scenes | Inputs | Outputs | SceneItems, + InputVolumeMeters
const EVENTS = 1 | 2 | 4 | 8 | 64 | 128 | (1 << 10) | (1 << 16); // + Ui (ScreenshotSaved, for the OSD)

// ------------------------------------------------------------------ config

let configCache = null; // { mtimeMs, data }

function readConfig() {
    let st = null;
    try { st = fs.statSync(CONFIG_FILE); } catch (_) { /* none yet */ }
    if (configCache && st && configCache.mtimeMs === st.mtimeMs) return configCache.data;
    let raw = {};
    if (st) raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const data = {
        obs: { ...DEFAULTS.obs, ...(raw.obs || {}) },
        profile: String(raw.profile || DEFAULTS.profile),
        collection: String(raw.collection || DEFAULTS.collection),
        youtube: { ...DEFAULTS.youtube, ...(raw.youtube || {}) },
        cabinets: (Array.isArray(raw.cabinets) && raw.cabinets.length ? raw.cabinets : DEFAULTS.cabinets)
            .filter((c) => c && c.id && c.scene)
            .map((c) => ({ id: String(c.id), name: String(c.name || c.id), scene: String(c.scene), icon: String(c.icon || c.id), short: String(c.short || c.name || c.id).slice(0, 3).toUpperCase(), xlink: c.xlink === false ? '' : String(c.xlink || c.id) })),
        launch: { ...DEFAULTS.launch, ...(raw.launch || {}) },
        satellite: { ...DEFAULTS.satellite, ...(raw.satellite && typeof raw.satellite === 'object' ? raw.satellite : {}) },
        units: { ...(raw.units && typeof raw.units === 'object' ? raw.units : {}) },
        osd: { ...DEFAULTS.osd, ...(raw.osd && typeof raw.osd === 'object' ? raw.osd : {}) },
        muxes: { ...DEFAULTS.muxes, ...(raw.muxes && typeof raw.muxes === 'object' ? raw.muxes : {}) }
    };
    configCache = st ? { mtimeMs: st.mtimeMs, data, raw } : null;
    return data;
}

function readRawConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { return {}; }
}

function writeRawConfig(raw) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 4)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, CONFIG_FILE);
    try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (_) { /* best effort */ }
    configCache = null;
}

yt.init({ read: readRawConfig, write: writeRawConfig });

function fail(message, code) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function cabinetOf(id) {
    const c = readConfig().cabinets.find((x) => x.id === id);
    if (!c) throw fail('Unknown cabinet', 'QUICKCAST_NO_CABINET');
    return c;
}

// ------------------------------------------------------------------ obs-websocket client

class ObsLink {
    /** opts.target() -> { host, port, password } (default: config.obs, OBS on Ruiko); opts.label names the
     *  machine in errors; opts.events is the EventSubscription mask (0 for a stats-only link). */
    constructor(opts = {}) {
        this.target = opts.target || (() => readConfig().obs);
        this.fixedLabel = opts.label || ''; // a mux unit's name; the satellite's comes from config
        this.events = opts.events == null ? EVENTS : opts.events;
        this.ws = null;
        this.ready = null;      // Promise while connecting / connected
        this.pending = new Map();
        this.seq = 0;
        this.version = '';
        this.listeners = new Set();
        this.meters = new Map(); // inputName -> { mag: [], peak: [], at }
        this.lastError = '';
    }

    get label() { return this.fixedLabel || satelliteName(); }

    get online() { return !!(this.ws && this.ws.readyState === WebSocket.OPEN && this.identified); }

    connect() {
        if (this.ready) return this.ready;
        const cfg = this.target();
        this.identified = false;
        this.ready = new Promise((resolve, reject) => {
            let settled = false;
            const done = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (err) { this.lastError = err.message; this.close(); reject(err); } else { this.lastError = ''; resolve(); }
            };
            const timer = setTimeout(() => done(fail(`${this.label} is not answering (encoder engine off?)`, 'QUICKCAST_OBS_TIMEOUT')), CONNECT_TIMEOUT_MS);
            let ws;
            try {
                ws = new WebSocket(`ws://${cfg.host}:${Number(cfg.port) || 4455}`, 'obswebsocket.json', { handshakeTimeout: CONNECT_TIMEOUT_MS, maxPayload: 64 * 1024 * 1024 });
            } catch (e) { done(e); return; }
            this.ws = ws;
            ws.on('error', (e) => {
                const refused = e && (e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT');
                done(fail(refused ? `${this.label}'s engine is not running` : `Control link to ${this.label} failed: ${e.message}`, refused ? 'QUICKCAST_OBS_DOWN' : 'QUICKCAST_OBS_ERROR'));
            });
            ws.on('close', (code, reason) => {
                done(fail(code === 4009 ? `${this.label} refused the control password` : `${this.label} closed the control link`, code === 4009 ? 'QUICKCAST_OBS_AUTH' : 'QUICKCAST_OBS_DOWN'));
                if (this.ws === ws) this.close();
                void reason;
            });
            ws.on('message', (buf) => {
                let msg;
                try { msg = JSON.parse(buf.toString('utf8')); } catch (_) { return; }
                const d = msg.d || {};
                if (msg.op === 0) { // Hello
                    this.version = d.obsWebSocketVersion || '';
                    const ident = { rpcVersion: 1, eventSubscriptions: this.events };
                    if (d.authentication) {
                        const pw = String(cfg.password || '');
                        const secret = crypto.createHash('sha256').update(pw + d.authentication.salt).digest('base64');
                        ident.authentication = crypto.createHash('sha256').update(secret + d.authentication.challenge).digest('base64');
                    }
                    ws.send(JSON.stringify({ op: 1, d: ident }));
                } else if (msg.op === 2) { // Identified
                    this.identified = true;
                    done(null);
                } else if (msg.op === 5) {
                    this.onEvent(d.eventType, d.eventData || {});
                } else if (msg.op === 9) { // RequestBatchResponse
                    const p = this.pending.get(d.requestId);
                    if (!p) return;
                    this.pending.delete(d.requestId);
                    clearTimeout(p.timer);
                    p.resolve(d.results || []);
                } else if (msg.op === 7) {
                    const p = this.pending.get(d.requestId);
                    if (!p) return;
                    this.pending.delete(d.requestId);
                    clearTimeout(p.timer);
                    const st = d.requestStatus || {};
                    if (st.result) p.resolve(d.responseData || {});
                    else p.reject(fail(st.comment || `${d.requestType} failed (${st.code})`, `OBS_${st.code || 'ERROR'}`));
                }
            });
        });
        return this.ready;
    }

    close() {
        const ws = this.ws;
        this.ws = null;
        this.ready = null;
        this.identified = false;
        this.meters.clear();
        for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(fail('The control link closed', 'QUICKCAST_OBS_DOWN')); }
        this.pending.clear();
        if (ws) { try { ws.terminate(); } catch (_) { /* gone */ } }
    }

    /** A request; while OBS is still loading (just started: 207 NotReady) it is retried for up to 45 s. */
    async request(requestType, requestData, timeoutMs) {
        const until = Date.now() + NOT_READY_WAIT_MS;
        for (;;) {
            try { return await this.requestOnce(requestType, requestData, timeoutMs); } catch (e) {
                if (e.code !== 'OBS_207' || Date.now() > until) throw e;
            }
            await new Promise((r) => setTimeout(r, 500));
        }
    }

    async requestOnce(requestType, requestData, timeoutMs) {
        await this.connect();
        const requestId = `qc${++this.seq}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(requestId); reject(fail(`${this.label} did not answer (${requestType})`, 'QUICKCAST_OBS_TIMEOUT')); }, timeoutMs || REQUEST_TIMEOUT_MS);
            this.pending.set(requestId, { resolve, reject, timer });
            try { this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } })); } catch (e) { clearTimeout(timer); this.pending.delete(requestId); reject(e); }
        });
    }

    /** A request batch (op 8). executionType 2 = SerialFrame: requests run on OBS's render ticks and
     *  { requestType: 'Sleep', requestData: { sleepFrames } } waits whole frames, so samples are taken on
     *  the box's own frame clock whatever the network does. Resolves the per-request results. */
    async batch(requests, opts = {}) {
        await this.connect();
        const requestId = `qcb${++this.seq}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(requestId); reject(fail(`${this.label} did not finish the measurement`, 'QUICKCAST_OBS_TIMEOUT')); }, opts.timeoutMs || 30000);
            this.pending.set(requestId, { resolve, reject, timer });
            try {
                this.ws.send(JSON.stringify({ op: 8, d: { requestId, haltOnFailure: !!opts.haltOnFailure, executionType: opts.executionType == null ? 2 : opts.executionType, requests } }));
            } catch (e) { clearTimeout(timer); this.pending.delete(requestId); reject(e); }
        });
    }

    onEvent(type, data) {
        if (type === 'InputVolumeMeters') {
            const now = Date.now();
            for (const inp of data.inputs || []) {
                const lv = Array.isArray(inp.inputLevelsMul) ? inp.inputLevelsMul : [];
                let m = this.meters.get(inp.inputName);
                if (!m) { m = { hist: [], at: now }; this.meters.set(inp.inputName, m); }
                // a short history, read by every client without clearing (several windows share it)
                m.hist.push({ at: now, mag: lv.map((ch) => Number(ch[0]) || 0), peak: lv.map((ch) => Number(ch[1]) || 0) });
                while (m.hist.length && now - m.hist[0].at > METER_WINDOW_MS) m.hist.shift();
                m.channels = lv.length;
                m.at = now;
            }
            return;
        }
        for (const fn of this.listeners) { try { fn(type, data); } catch (_) { /* listener's own problem */ } }
    }

    /** Wait for an event that passes test(data), or time out (resolves null). */
    waitFor(type, test, timeoutMs) {
        return new Promise((resolve) => {
            const fn = (t, d) => { if (t === type && (!test || test(d))) { cleanup(); resolve(d); } };
            const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
            const cleanup = () => { clearTimeout(timer); this.listeners.delete(fn); };
            this.listeners.add(fn);
        });
    }

    /** The meters over the last METER_WINDOW_MS (maxima), shared by every reader: nothing is reset. */
    takeMeters() {
        const out = new Map();
        const now = Date.now();
        for (const [name, m] of this.meters) {
            if (now - m.at > 2000) { this.meters.delete(name); continue; }
            const n = m.channels || 0;
            const mag = new Array(n).fill(0);
            const peak = new Array(n).fill(0);
            for (const h of m.hist) {
                if (now - h.at > METER_WINDOW_MS) continue;
                for (let i = 0; i < n; i++) { mag[i] = Math.max(mag[i], h.mag[i] || 0); peak[i] = Math.max(peak[i], h.peak[i] || 0); }
            }
            out.set(name, { mag, peak });
        }
        return out;
    }
}

const link = new ObsLink();
diag.init({ ruiko: link, readConfig, makeLink: (target, label) => new ObsLink({ target, label, events: 4 | 128 | (1 << 10) }) /* Scenes + SceneItems + Ui: status on a take, screenshot notice */ });
diag.onUnitRestart((machine) => void avOsd.powerOn(`mux-${machine}`, { reason: 'reset' }).catch(() => {}));
avOsd.init({
    keepAlive: () => touch(),
    xlinkMenu: (cab, force) => cabinetXlinkMenu(cab, force), xlinkDo: (req) => cabinetXlinkDo(req),
    ruiko: link, diag, readConfig, dataDir: DATA_DIR, unitModel: (n) => unitModel(n), unitInfo: (n, r) => unitInfo(n, r), satelliteName: () => satelliteName(),
    // on air = the satellite is streaming and (for a mux box) its cabinet's scene is on program
    onAir: async (b) => {
        if (!link.online) return false;
        const st = await link.request('GetStreamStatus', {}, 3000).catch(() => ({}));
        if (!st.outputActive) return false;
        if (b.kind === 'satellite') return true;
        const pg = (await link.request('GetCurrentProgramScene', {}, 3000).catch(() => ({}))).currentProgramSceneName;
        for (const c of readConfig().cabinets) {
            if (c.scene !== pg) continue;
            const m = await diag.machineForCabinet(c.id).catch(() => '');
            if (m && m === b.machine) return true;
        }
        return false;
    }
});
let leaseTimer = null;
let launching = null;        // Promise while OBS is being started
let launchStartedAt = 0;
let launchStep = '';         // what the engine start is doing (front panel boot progress)
let launchError = '';        // the last engine start that failed (front panel alarm until the next start)
let engineHung = false;      // an OBS process on Ruiko whose control port does not answer (front panel ALARM)
let hungCheckAt = 0;         // last process check while the control port is silent
const STUCK_WAIT_MS = 20000; // an already running engine gets this long to answer before it is restarted
let lastBytes = null;        // { bytes, at } for the bitrate
let audioSet = { scene: '', at: 0, inputs: [] };
let busy = null;             // a prepare / go-live / stop in progress (one at a time)
let lastTry = 0;             // last connect attempt from a status poll (OBS offline)

function touch() {
    clearTimeout(leaseTimer);
    leaseTimer = setTimeout(() => link.close(), LEASE_MS);
    if (leaseTimer.unref) leaseTimer.unref();
}

async function exclusive(label, fn) {
    if (busy) throw fail(`QuickCast is busy (${busy})`, 'QUICKCAST_BUSY');
    busy = label;
    try { return await fn(); } finally { busy = null; }
}

// ------------------------------------------------------------------ launching OBS

function sshRun(cmd, timeoutMs) {
    const host = readConfig().launch.ssh;
    return new Promise((resolve) => {
        execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', host, cmd], { timeout: timeoutMs || 20000, windowsHide: true }, (err, stdout, stderr) => {
            resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') });
        });
    });
}

const ENGINE_RUNNING = async () => { const l = await sshRun('tasklist /FI "IMAGENAME eq obs64.exe" /NH'); return l.ok ? /obs64\.exe/i.test(l.out) : null; };

/**
 * OBS 32 has no --disable-shutdown-check: after a crash or a forced close it finds its run_* sentinel files
 * and asks "Run in Safe Mode?" on Ruiko's screen, which holds the start (and Safe Mode has no websocket).
 * With no OBS running those files are only stale, so they are cleared before every start.
 */
async function clearCrashSentinel() {
    await sshRun('Remove-Item -Force -ErrorAction SilentlyContinue "$env:APPDATA\\obs-studio\\.sentinel\\run_*"');
}

/** Close OBS on Ruiko with the stop task (graceful, forced after 12 s) and wait until it is gone. */
async function runStopTask(waitMs) {
    const task = readConfig().launch.stopTask;
    if (!/^[\\\w .-]+$/.test(task)) throw fail('The stop task name is not valid', 'QUICKCAST_LAUNCH');
    const r = await sshRun(`schtasks /Run /TN "${task}"`);
    if (!r.ok || !/SUCCESS/i.test(r.out)) throw fail(`Could not shut down ${satelliteName()}'s encoder engine: ${(r.err || r.out).trim().slice(0, 200)}`, 'QUICKCAST_LAUNCH');
    const until = Date.now() + (waitMs || 40000);
    for (;;) {
        await new Promise((res) => setTimeout(res, 1500));
        if (await ENGINE_RUNNING() === false) return;
        if (Date.now() > until) throw fail(`${satelliteName()}'s encoder engine is still running after ${Math.round((waitMs || 40000) / 1000)} s`, 'QUICKCAST_LAUNCH');
    }
}

/**
 * Start OBS with the Ruiko task, then wait until its websocket answers. Turn it on and go: an OBS that
 * is running but never answers (stuck on a prompt, hung) is closed and started fresh, never left for
 * someone to fix at the machine.
 */
function launchObs() {
    if (launching) return launching;
    launching = (async () => {
        launchStartedAt = Date.now();
        launchStep = 'CHECKING ENGINE';
        const task = readConfig().launch.task;
        if (!/^[\\\w .-]+$/.test(task)) throw fail('The launch task name is not valid', 'QUICKCAST_LAUNCH');
        const start = async () => {
            launchStep = 'CLEARING CRASH FLAGS';
            await clearCrashSentinel();
            launchStep = 'STARTING ENGINE';
            const r = await sshRun(`schtasks /Run /TN "${task}"`);
            if (!r.ok || !/SUCCESS/i.test(r.out)) throw fail(`Could not start ${satelliteName()}'s encoder engine: ${(r.err || r.out).trim().slice(0, 200)}`, 'QUICKCAST_LAUNCH');
        };
        const answer = async (ms) => {
            const until = Date.now() + ms;
            for (;;) {
                try { await link.connect(); return true; } catch (e) {
                    if (e.code === 'QUICKCAST_OBS_AUTH') throw e;
                    if (Date.now() > until) return false;
                }
                await new Promise((r) => setTimeout(r, 1000));
            }
        };
        let already = await ENGINE_RUNNING() === true;
        if (already) {
            launchStep = 'WAITING FOR CONTROL';
            if (await answer(STUCK_WAIT_MS)) { engineHung = false; return true; }
            // running but silent: restart it
            engineHung = true;
            launchStep = 'ENGINE STUCK RESTART';
            console.warn(`[visioncaster] ${satelliteName()}'s encoder engine runs but its control port does not answer: restarting it`);
            await runStopTask(40000);
            already = false;
        }
        await start();
        launchStep = 'WAITING FOR CONTROL';
        if (!await answer(LAUNCH_WAIT_MS)) {
            engineHung = await ENGINE_RUNNING() === true;
            throw fail(`${satelliteName()}'s encoder engine did not come up within a minute${engineHung ? ': it is running but does not answer (RESET restarts it)' : ''}`, 'QUICKCAST_LAUNCH');
        }
        engineHung = false;
        setTimeout(() => void avOsd.powerOn('sat', { reason: 'power' }).catch(() => {}), 1500);
        return true;
    })().finally(() => { launching = null; launchStep = ''; });
    return launching;
}

/** Connected, starting OBS when allowed and it is not running. */
async function ensureObs(allowLaunch) {
    touch();
    try { await link.connect(); } catch (e) {
        // a closed OBS: refused, or (Ruiko's firewall drops packets to a port nobody listens on) no answer
        if (!allowLaunch || (e.code !== 'QUICKCAST_OBS_DOWN' && e.code !== 'QUICKCAST_OBS_TIMEOUT')) throw e;
        await launchObs();
    }
}

// ------------------------------------------------------------------ OBS state

async function ensureCollection() {
    const want = readConfig().collection;
    const r = await link.request('GetSceneCollectionList');
    if (r.currentSceneCollectionName === want) return false;
    if (!(r.sceneCollections || []).includes(want)) throw fail(`${satelliteName()} has no layout set "${want}"`, 'QUICKCAST_NO_COLLECTION');
    const changed = link.waitFor('CurrentSceneCollectionChanged', (d) => d.sceneCollectionName === want, SWITCH_WAIT_MS);
    await link.request('SetCurrentSceneCollection', { sceneCollectionName: want }, SWITCH_WAIT_MS);
    await changed;
    return true;
}

async function ensureProfile() {
    const want = readConfig().profile;
    const r = await link.request('GetProfileList');
    if (r.currentProfileName === want) return false;
    if (!(r.profiles || []).includes(want)) throw fail(`${satelliteName()} has no output preset "${want}"`, 'QUICKCAST_NO_PROFILE');
    const changed = link.waitFor('CurrentProfileChanged', (d) => d.profileName === want, SWITCH_WAIT_MS);
    await link.request('SetCurrentProfile', { profileName: want }, SWITCH_WAIT_MS);
    await changed;
    return true;
}

/** The inputs heard on the stream when `scene` is on program: the scene's enabled items (nested
 *  scenes and groups too) and the global audio devices, less monitor-only and off-track inputs. */
async function audioInputsFor(scene) {
    if (audioSet.scene === scene && Date.now() - audioSet.at < AUDIO_SET_TTL_MS) return audioSet.inputs;
    const names = new Set();
    const seen = new Set();
    const walk = async (name, group) => {
        if (seen.has(name)) return;
        seen.add(name);
        let items = [];
        try { items = (await link.request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName: name })).sceneItems || []; } catch (_) { return; }
        for (const it of items) {
            if (!it.sceneItemEnabled) continue;
            if (it.isGroup) await walk(it.sourceName, true);
            else if (it.sourceType === 'OBS_SOURCE_TYPE_SCENE') await walk(it.sourceName, false);
            else names.add(it.sourceName);
        }
    };
    await walk(scene, false);
    try {
        const sp = await link.request('GetSpecialInputs');
        ['desktop1', 'desktop2', 'mic1', 'mic2', 'mic3', 'mic4'].forEach((k) => { if (sp[k]) names.add(sp[k]); });
    } catch (_) { /* older OBS */ }
    let track = '1';
    try {
        const mode = await link.request('GetProfileParameter', { parameterCategory: 'Output', parameterName: 'Mode' });
        if (mode.parameterValue === 'Advanced') {
            const t = await link.request('GetProfileParameter', { parameterCategory: 'AdvOut', parameterName: 'TrackIndex' });
            track = String(t.parameterValue || t.defaultParameterValue || '1');
        }
    } catch (_) { /* default track */ }
    const inputs = [];
    for (const name of names) {
        try {
            const mon = await link.request('GetInputAudioMonitorType', { inputName: name });
            if (mon.monitorType === 'OBS_MONITORING_TYPE_MONITOR_ONLY') continue;
            const tr = await link.request('GetInputAudioTracks', { inputName: name });
            if (tr.inputAudioTracks && tr.inputAudioTracks[track] === false) continue;
            const mu = await link.request('GetInputMute', { inputName: name });
            inputs.push({ name, muted: !!mu.inputMuted });
        } catch (_) { /* not an audio input */ }
    }
    audioSet = { scene, at: Date.now(), inputs };
    return inputs;
}

const toDb = (mul) => (mul > 0 ? Math.max(-100, 20 * Math.log10(mul)) : -100);
const round1 = (n) => Math.round(n * 10) / 10;

function keyHint(key) {
    const k = String(key || '');
    return k ? `••••-${k.slice(-4)}` : '';
}

/** A fault as it bears on one cabinet: satellite alarms only for inputs that cabinet uses (or global ones). */
function scopeFault(f, cabinetId, machine) {
    if (f.kind === 'satellite') {
        const items = f.items.filter((i) => !i.cabs || !i.cabs.length || i.cabs.includes(cabinetId));
        return items.length ? { ...f, items } : null;
    }
    return machine && f.machine === machine ? f : null;
}

/** Everything the client shows, one read per poll (~8 Hz). Never throws for an offline OBS.
 *  opts.cabinet: the picked cabinet, for the pipeline diagnostics (default: the one on program). */
async function status(opts = {}) {
    touch();
    const cfg = readConfig();
    const base = {
        busy,
        satellite: { name: satelliteName(), model: unitModel(satelliteName()), kind: unitInfo(satelliteName(), 'satellite').kind, host: `${cfg.obs.host}:${Number(cfg.obs.port) || 4455}` },
        obs: { state: launching ? 'launching' : stopping ? 'stopping' : 'offline', version: link.version, error: link.lastError, launchingFor: launching ? Date.now() - launchStartedAt : 0, launchStep: launching ? launchStep : '', hung: engineHung, launchError: launching ? '' : launchError },
        cabinets: cfg.cabinets.map((c) => ({ id: c.id, name: c.name, scene: c.scene, icon: c.icon, short: c.short, present: false })),
        key: { set: !!cfg.youtube.streamKey, hint: keyHint(cfg.youtube.streamKey) },
        watchUrl: cfg.youtube.watchUrl || '',
        want: { profile: cfg.profile, collection: cfg.collection },
        youtube: { account: yt.account(), last: yt.lastSettings(), broadcast: yt.broadcastInfo() }
    };
    if (!link.online) {
        if (launching || Date.now() - lastTry < 2000) return base;
        lastTry = Date.now();
        try { await link.connect(); } catch (_) {
            base.obs.error = link.lastError;
            // silent control port: is an engine process there anyway (stuck)? checked every 20 s, off the poll
            if (!stopping && Date.now() - hungCheckAt > 20000) {
                hungCheckAt = Date.now();
                void ENGINE_RUNNING().then((run) => { if (run !== null && !launching && !link.online) engineHung = run; }).catch(() => {});
            }
            return base;
        }
        engineHung = false;
        launchError = '';
    }
    base.obs.state = 'online';
    base.obs.version = link.version;
    try {
        const [col, prof, scenes, stream, video, stats] = await Promise.all([
            link.request('GetSceneCollectionList'),
            link.request('GetProfileList'),
            link.request('GetSceneList'),
            link.request('GetStreamStatus'),
            link.request('GetVideoSettings'),
            link.request('GetStats')
        ]);
        const sceneNames = new Set((scenes.scenes || []).map((s) => s.sceneName));
        base.collection = col.currentSceneCollectionName;
        base.profile = prof.currentProfileName;
        base.program = scenes.currentProgramSceneName;
        base.cabinets.forEach((c) => { c.present = base.collection === cfg.collection && sceneNames.has(c.scene); });
        const onAir = base.cabinets.find((c) => c.present && c.scene === base.program);
        base.programCabinet = onAir ? onAir.id : '';
        const now = Date.now();
        let kbps = 0;
        if (stream.outputActive && lastBytes && now > lastBytes.at && stream.outputBytes >= lastBytes.bytes) {
            kbps = Math.round(((stream.outputBytes - lastBytes.bytes) * 8) / (now - lastBytes.at));
        }
        if (stream.outputActive) {
            if (!lastBytes || now - lastBytes.at > 1500) lastBytes = { bytes: stream.outputBytes, at: now, kbps };
            else kbps = lastBytes.kbps || kbps;
        } else lastBytes = null;
        base.youtube.live = yt.viewers(!!stream.outputActive);
        base.stream = {
            active: !!stream.outputActive,
            reconnecting: !!stream.outputReconnecting,
            timecode: stream.outputTimecode || '00:00:00.000',
            durationMs: stream.outputDuration || 0,
            congestion: round1((stream.outputCongestion || 0) * 100),
            kbps,
            skipped: stream.outputSkippedFrames || 0,
            frames: stream.outputTotalFrames || 0
        };
        base.video = {
            base: `${video.baseWidth}x${video.baseHeight}`,
            output: `${video.outputWidth}x${video.outputHeight}`,
            fps: video.fpsDenominator ? round1(video.fpsNumerator / video.fpsDenominator) : 0,
            activeFps: round1(stats.activeFps || 0),
            cpu: round1(stats.cpuUsage || 0),
            renderSkipped: stats.renderSkippedFrames || 0,
            renderTotal: stats.renderTotalFrames || 0
        };
        // meters for what the stream hears with the program scene on
        const meters = link.takeMeters();
        let inputs = [];
        if (base.program) { try { inputs = await audioInputsFor(base.program); } catch (_) { inputs = []; } }
        const master = { mag: [-100, -100], peak: [-100, -100] };
        base.inputs = inputs.map((inp) => {
            const m = meters.get(inp.name) || { mag: [], peak: [] };
            const mag = m.mag.map(toDb);
            const peak = m.peak.map(toDb);
            if (!inp.muted) {
                for (let ch = 0; ch < 2; ch++) {
                    const i = Math.min(ch, Math.max(0, mag.length - 1));
                    if (mag.length) {
                        master.mag[ch] = Math.max(master.mag[ch], mag[i]);
                        master.peak[ch] = Math.max(master.peak[ch], peak[i]);
                    }
                }
            }
            return { name: inp.name, muted: inp.muted, mag: mag.map(round1), peak: peak.map(round1) };
        });
        base.master = { mag: master.mag.map(round1), peak: master.peak.map(round1) };
        base.youtube.health = yt.streamHealth(!!stream.outputActive);
        const pick = cfg.cabinets.some((c) => c.id === opts.cabinet) ? opts.cabinet : base.programCabinet;
        try { base.diag = diag.diagnose(base, stats, pick); } catch (_) { base.diag = null; }
        if (base.diag && base.diag.input && base.diag.input.source) base.diag.input.align = avOsd.alignFor(base.diag.input.source);
        if (base.diag && base.diag.input && base.diag.input.source && pick) avOsd.noteCabinet(base.diag.input.source, pick);
        if (base.diag && base.diag.input && base.diag.input.source) {
            const us = avOsd.unitState(base.diag.input.source);
            if (us.powerOff) {
                base.diag.input = { source: base.diag.input.source, sourceDetail: base.diag.input.sourceDetail, stages: [], note: 'Cabinet powered off (XLink power O): the mixer is off' };
                base.diag.verdict = { state: 'off', text: 'Cabinet powered off' };
            } else if (us.standby) base.diag.verdict = { state: 'off', text: 'Cabinet in standby (low power image)' };
        }
        // latched self-test faults on the satellite and this cabinet's mixer (LIVE locks on them)
        const mux = base.diag && base.diag.input && base.diag.input.source;
        base.faults = avOsd.faults().map((f) => scopeFault(f, pick, mux)).filter(Boolean);
    } catch (e) {
        base.obs.error = e.message;
        if (!link.online) base.obs.state = 'offline';
    }
    return base;
}

// ------------------------------------------------------------------ units (the boxes as hardware)

/**
 * The hardware each unit is, as its own boot / system-test cards show it (Nov 10): the satellite is an
 * AmuVISION Satellite iSVE-20D (Ruiko's waiting slate), the cabinet mixers are TAKAO iUHD-4DX network
 * video mixers (PLG-EAST-1's SysTest card). config.units[name] overrides per unit.
 */
const UNIT_DEFAULTS = {
    satellite: { maker: 'AmuVISION', model: 'iSVE-20D', line: 'Satellite', kind: 'Network Video Mixer', theme: 'amuvision' },
    mux: { maker: 'TAKAO', model: 'iUHD-4DX', line: '', kind: 'Network Video Mixer', theme: 'takao', sw: '4.07', hw: '2.0', fw: '3.0-934f21a4' }
};

function unitInfo(name, role) {
    const key = String(name || '').toUpperCase();
    const cfg = readConfig();
    const set = Object.keys(cfg.units).find((k) => k.toUpperCase() === key);
    const d = UNIT_DEFAULTS[role === 'satellite' ? 'satellite' : 'mux'];
    const u = { ...d, ...(set ? cfg.units[set] : {}) };
    return { sw: String(u.sw || ''), hw: String(u.hw || ''), fw: String(u.fw || ''), name: key, maker: String(u.maker || ''), model: String(u.model || ''), line: String(u.line || ''), kind: String(u.kind || ''), theme: String(u.theme || d.theme), full: [u.maker, u.line, u.model].filter(Boolean).join(' ') };
}

function unitModel(name) { return unitInfo(name, String(name || '').toUpperCase() === satelliteName() ? 'satellite' : 'mux').full; }

function satelliteName() { return String(readConfig().satellite.name || 'SATELLITE').toUpperCase(); }

// ------------------------------------------------------------------ realtime preview (MJPEG)

const liveTickets = new Map(); // ticket -> { cabinet, width, at, res }
const LIVE_FPS_MAX = 25;

/**
 * REALTIME preview: a one-time ticket (minted over the admin-checked websocket) for an MJPEG stream of
 * the cabinet's scene at /quickcast/live/<ticket>. A browser <img> plays MJPEG natively; RTSP would need
 * a transcoder. Frames come from OBS on Ruiko (never a mux PC), as fast as it answers up to 25 fps.
 */
function liveTicket(cabinetId, width, prev) {
    const c = cabinetOf(cabinetId);
    // the monitor moved to another input: end its previous stream now (the browser does not always drop
    // an MJPEG <img> connection when its src changes, and a stale one holds the link to OBS)
    const old = prev && liveTickets.get(String(prev));
    if (old) { old.closed = true; liveTickets.delete(String(prev)); try { if (old.res) old.res.end(); } catch (_) { /* gone */ } }
    for (const [t, x] of liveTickets) if (!x.res && Date.now() - x.at > 30000) liveTickets.delete(t);
    const ticket = crypto.randomBytes(18).toString('base64url');
    liveTickets.set(ticket, { cabinet: c.id, width: Math.max(160, Math.min(1280, Number(width) || 640)), at: Date.now(), res: null });
    return { ticket, url: `/quickcast/live/${ticket}` };
}

async function liveStream(ticket, req, res) {
    const t = liveTickets.get(String(ticket || ''));
    if (!t || t.res) { res.status(404).end(); return; }
    t.res = res;
    const boundary = 'qcframe';
    res.writeHead(200, { 'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`, 'Cache-Control': 'no-store', Connection: 'close', 'X-Accel-Buffering': 'no' });
    let open = true;
    req.on('close', () => { open = false; liveTickets.delete(ticket); });
    const scene = cabinetOf(t.cabinet).scene;
    while (open && !t.closed) {
        const t0 = Date.now();
        touch();
        try {
            if (!link.online) await link.connect();
            const r = await link.request('GetSourceScreenshot', { sourceName: scene, imageFormat: 'jpg', imageWidth: t.width, imageCompressionQuality: 70 }, 5000);
            const buf = Buffer.from(String(r.imageData || '').replace(/^data:image\/\w+;base64,/, ''), 'base64');
            if (!open || t.closed) break;
            res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
            res.write(buf);
            res.write('\r\n');
        } catch (_) { await new Promise((r) => setTimeout(r, 1000)); }
        const wait = 1000 / LIVE_FPS_MAX - (Date.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    try { res.end(); } catch (_) { /* gone */ }
}

/** A JPEG of the cabinet's scene (what goes on air with it), as a data URL. */
async function preview(cabinetId, width) {
    touch();
    if (!link.online) throw fail(`No control link to ${satelliteName()}`, 'QUICKCAST_OBS_DOWN');
    const c = cabinetOf(cabinetId);
    const w = Math.max(160, Math.min(1280, Number(width) || 640));
    const r = await link.request('GetSourceScreenshot', { sourceName: c.scene, imageFormat: 'jpg', imageWidth: w, imageCompressionQuality: 72 });
    return { cabinet: c.id, image: r.imageData || '', at: Date.now() };
}

/**
 * Get a cabinet ready: OBS up (started on Ruiko when it is not running), the Remote Play collection,
 * the QuickCast profile, and the cabinet's scene on program. While live, switching the scene needs
 * confirmed (it changes what viewers see); collection and profile never switch while live.
 */
async function prepare(cabinetId, confirmed) {
    const c = cabinetOf(cabinetId);
    return exclusive('preparing', async () => {
        await ensureObs(true);
        const st = await link.request('GetStreamStatus');
        const steps = [];
        if (!st.outputActive) {
            if (await ensureCollection()) steps.push('collection');
            const rec = await link.request('GetRecordStatus').catch(() => ({}));
            if (!rec.outputActive && await ensureProfile()) steps.push('profile');
        }
        const scenes = await link.request('GetSceneList');
        if (!(scenes.scenes || []).some((s) => s.sceneName === c.scene)) throw fail(`The layout "${c.scene}" is missing on ${satelliteName()}`, 'QUICKCAST_NO_SCENE');
        if (scenes.currentProgramSceneName !== c.scene) {
            if (st.outputActive && !confirmed) return { needsConfirm: true, live: true, cabinet: c.id };
            await link.request('SetCurrentProgramScene', { sceneName: c.scene });
            steps.push('scene');
        }
        audioSet.at = 0;
        return { ok: true, cabinet: c.id, steps, live: !!st.outputActive };
    });
}

/** Go live with the cabinet: stream key into the QuickCast profile, scene on program, Start Streaming. */
async function goLive(cabinetId, settings) {
    const c = cabinetOf(cabinetId);
    const cfg = readConfig();
    if (!cfg.youtube.streamKey) throw fail('No uplink key is set (Stream > Uplink Key...)', 'QUICKCAST_NO_KEY');
    // self-test faults on the chain are advisory (the client lists them before LIVE); they never block
    return exclusive('going live', async () => {
        await ensureObs(true);
        const st = await link.request('GetStreamStatus');
        if (st.outputActive) return { ok: true, already: true };
        await ensureCollection();
        const prof = await link.request('GetProfileList');
        if (prof.currentProfileName !== cfg.profile) {
            const rec = await link.request('GetRecordStatus').catch(() => ({}));
            if (rec.outputActive) throw fail(`${satelliteName()} is recording in the "${prof.currentProfileName}" preset. Stop the recording first.`, 'QUICKCAST_RECORDING');
            await ensureProfile();
        }
        await link.request('SetStreamServiceSettings', {
            streamServiceType: 'rtmp_common',
            streamServiceSettings: { service: cfg.youtube.service, server: cfg.youtube.server, key: cfg.youtube.streamKey, bwtest: false }
        });
        const scenes = await link.request('GetSceneList');
        if (scenes.currentProgramSceneName !== c.scene) await link.request('SetCurrentProgramScene', { sceneName: c.scene });
        // signed in: a new broadcast with the title etc., bound to the key's stream; else just remember them
        let broadcast = null;
        if (yt.account().signedIn) broadcast = await yt.prepareBroadcast(cfg.youtube.streamKey, settings);
        else if (settings) await yt.saveSettings(settings);
        const started = link.waitFor('StreamStateChanged', (d) => d.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED' || d.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED', START_WAIT_MS);
        await link.request('StartStream');
        const ev = await started;
        const after = await link.request('GetStreamStatus');
        if (!after.outputActive) {
            throw fail(ev && ev.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED'
                ? `${satelliteName()} could not connect to YouTube. Check the uplink key and the satellite's network (the reason shows on its console).`
                : `${satelliteName()} did not go on air within 15 seconds`, 'QUICKCAST_START_FAILED');
        }
        lastBytes = null;
        return { ok: true, cabinet: c.id, broadcast };
    });
}

async function stop() {
    return exclusive('stopping', async () => {
        await ensureObs(false);
        const st = await link.request('GetStreamStatus');
        if (!st.outputActive) return { ok: true, already: true };
        const stopped = link.waitFor('StreamStateChanged', (d) => d.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED', START_WAIT_MS);
        await link.request('StopStream');
        await stopped;
        const after = await link.request('GetStreamStatus');
        if (after.outputActive) throw fail(`${satelliteName()} is still on air`, 'QUICKCAST_STOP_FAILED');
        void yt.endBroadcast();
        return { ok: true };
    });
}

// ------------------------------------------------------------------ encoder settings

const ENC_FILE = '$env:APPDATA\\obs-studio\\basic\\profiles\\';
const HEIGHTS = { 720: 1280, 900: 1600, 1080: 1920, 1440: 2560 };
const AUDIO_RATES = [96, 128, 160, 192, 256, 320];

/** PowerShell on Ruiko over SSH (the script is base64 UTF-16, so nothing in it needs quoting). */
function ps(script, timeoutMs) {
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    return sshRun(`powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`, timeoutMs || 30000);
}

function profileDir() {
    const name = readConfig().profile;
    if (!/^[\w .-]+$/.test(name)) throw fail('The profile name is not valid', 'QUICKCAST_NO_PROFILE');
    return `${ENC_FILE}${name}`;
}

async function streamTrack() {
    try {
        const t = await link.request('GetProfileParameter', { parameterCategory: 'AdvOut', parameterName: 'TrackIndex' });
        return String(t.parameterValue || t.defaultParameterValue || '1');
    } catch (_) { return '1'; }
}

/** The QuickCast profile's encoder: video bitrate / rate control (streamEncoder.json on Ruiko), audio
 *  bitrate (the stream track's), output resolution and fps. */
async function getEncoder() {
    await ensureObs(false);
    await ensureProfile();
    const r = await ps(`Get-Content -Raw -LiteralPath "${profileDir()}\\streamEncoder.json"`);
    let enc = {};
    try { enc = JSON.parse(r.out.trim().replace(/^﻿/, '')); } catch (_) { enc = {}; }
    const track = await streamTrack();
    const ab = await link.request('GetProfileParameter', { parameterCategory: 'AdvOut', parameterName: `Track${track}Bitrate` }).catch(() => ({}));
    const v = await link.request('GetVideoSettings');
    return {
        bitrate: Number(enc.bitrate) || 2500,
        rateControl: String(enc.rate_control || 'CBR'),
        audioBitrate: Number(ab.parameterValue || ab.defaultParameterValue) || 160,
        height: v.outputHeight,
        fps: v.fpsDenominator ? Math.round(v.fpsNumerator / v.fpsDenominator) : 0,
        heights: Object.keys(HEIGHTS).map(Number),
        audioRates: AUDIO_RATES
    };
}

/** Change the encoder (not while streaming): written into the profile, then the profile is reloaded
 *  (switched away and back) so OBS picks the new streamEncoder.json up for sure. */
async function setEncoder(o) {
    const bitrate = Math.round(Number(o.bitrate));
    if (!(bitrate >= 500 && bitrate <= 51000)) throw fail('Video bitrate must be 500 - 51,000 kb/s', 'QUICKCAST_BAD_ENCODER');
    const rc = o.rateControl === 'VBR' ? 'VBR' : 'CBR';
    const height = Number(o.height);
    if (!HEIGHTS[height]) throw fail('Unknown resolution', 'QUICKCAST_BAD_ENCODER');
    const fps = Number(o.fps);
    if (fps !== 30 && fps !== 60) throw fail('FPS must be 30 or 60', 'QUICKCAST_BAD_ENCODER');
    const audio = Number(o.audioBitrate);
    if (!AUDIO_RATES.includes(audio)) throw fail('Unknown audio bitrate', 'QUICKCAST_BAD_ENCODER');
    return exclusive('applying the encoder settings', async () => {
        await ensureObs(true);
        const st = await link.request('GetStreamStatus');
        if (st.outputActive) throw fail('Stop the stream before changing the encoder', 'QUICKCAST_LIVE');
        const rec = await link.request('GetRecordStatus').catch(() => ({}));
        if (rec.outputActive) throw fail(`${satelliteName()} is recording; stop the recording first`, 'QUICKCAST_RECORDING');
        await ensureProfile();
        const dir = profileDir();
        const w = await ps(`$f = "${dir}\\streamEncoder.json"
$j = @{}
if (Test-Path -LiteralPath $f) { $o = Get-Content -Raw -LiteralPath $f | ConvertFrom-Json; $o.PSObject.Properties | % { $j[$_.Name] = $_.Value } }
$j['bitrate'] = ${bitrate}
$j['rate_control'] = '${rc}'
$j['max_bitrate'] = ${rc === 'VBR' ? Math.round(bitrate * 1.5) : bitrate}
[IO.File]::WriteAllText($f, ($j | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
'written'`);
        if (!/written/.test(w.out)) throw fail(`Could not load the encoder settings into ${satelliteName()}: ${(w.err || w.out).trim().slice(0, 200)}`, 'QUICKCAST_ENCODER');
        const track = await streamTrack();
        await link.request('SetProfileParameter', { parameterCategory: 'AdvOut', parameterName: `Track${track}Bitrate`, parameterValue: String(audio) });
        // resolution / fps: into the profile always; live only when no output holds the video (DistroAV's
        // always-on NDI Main Output does), else they apply the next time OBS starts
        const v = await link.request('GetVideoSettings');
        let videoPending = false;
        if (v.outputHeight !== height || Math.round(v.fpsNumerator / (v.fpsDenominator || 1)) !== fps) {
            const params = [['OutputCX', String(HEIGHTS[height])], ['OutputCY', String(height)], ['FPSType', '0'], ['FPSCommon', String(fps)]];
            for (const [name, value] of params) await link.request('SetProfileParameter', { parameterCategory: 'Video', parameterName: name, parameterValue: value });
            try {
                await link.request('SetVideoSettings', { outputWidth: HEIGHTS[height], outputHeight: height, fpsNumerator: fps, fpsDenominator: 1 });
            } catch (e) { if (/output is active/i.test(e.message)) videoPending = true; else throw e; }
        }
        // reload the profile so the encoder settings are read again
        const prof = await link.request('GetProfileList');
        const other = (prof.profiles || []).find((p) => p !== readConfig().profile);
        if (other) {
            let changed = link.waitFor('CurrentProfileChanged', (d) => d.profileName === other, SWITCH_WAIT_MS);
            await link.request('SetCurrentProfile', { profileName: other }, SWITCH_WAIT_MS);
            await changed;
            await ensureProfile();
        }
        return { ok: true, videoPending, encoder: await getEncoder() };
    });
}

/** Mute / unmute one of the inputs the stream hears (only those: the program scene's audio set). */
async function setMute(name, muted) {
    touch();
    if (!link.online) throw fail(`No control link to ${satelliteName()}`, 'QUICKCAST_OBS_DOWN');
    const scenes = await link.request('GetSceneList');
    const inputs = await audioInputsFor(scenes.currentProgramSceneName);
    if (!inputs.some((i) => i.name === name)) throw fail('That source is not in the stream mix', 'QUICKCAST_NO_INPUT');
    await link.request('SetInputMute', { inputName: name, inputMuted: !!muted });
    audioSet.at = 0;
    return { ok: true, name, muted: !!muted };
}

// ------------------------------------------------------------------ XLink cabinet controls

// Only these XLink items are reachable from QuickCast (matched by their menu.json text)
const XL_VIDEO = /vision\s*control/i;
const XL_POWER = /^power\s*switch$/i;
const XL_GAME = /^game\s*select$/i;
const XL_RESET = /reset\s*encoder/i;

function findItem(items, re) {
    const i = (items || []).findIndex((it) => re.test(it.text || ''));
    return i < 0 ? null : { i, it: items[i] };
}

/** The cabinet's video / encoder, power and game controls from its XLink device (menu.json). */
async function cabinetControls(cabinetId, force) {
    const c = cabinetOf(cabinetId);
    if (!c.xlink) return { cabinet: c.id, available: false };
    let snap;
    try { snap = await xlink.device(c.xlink, { force: !!force }); } catch (e) {
        if (e.code === 'XLINK_NO_DEVICE' || e.code === 'XLINK_NO_MENU') return { cabinet: c.id, available: false };
        throw e;
    }
    const v = findItem(snap.items, XL_VIDEO);
    const p = findItem(snap.items, XL_POWER);
    const g = findItem(snap.items, XL_GAME);
    const reset = v ? findItem(v.it.children, XL_RESET) : null;
    const st = (x) => (x && x.status ? { text: x.status.text, color: x.status.color, failed: !!x.status.failed } : null);
    const row = (t) => (t || []).map((b, n) => ({ n, label: /^auto$/i.test(b.label) ? 'GAME' : b.label, active: !!b.active, bg: b.bg || '', color: b.color || '' }));
    return {
        cabinet: c.id,
        available: true,
        device: { key: snap.key, name: snap.name, status: st(snap) },
        video: v && v.it.toggle ? { path: [v.i], buttons: row(v.it.toggle), status: st(v.it), resetPath: reset ? [v.i, reset.i] : null } : null,
        power: p && p.it.toggle ? { path: [p.i], buttons: row(p.it.toggle), status: st(p.it), warning: p.it.warning } : null,
        game: g ? { path: [g.i], status: st(g.it), warning: g.it.warning, options: (g.it.children || []).map((ch, j) => ({ path: [g.i, j], text: ch.text })).filter((o) => o.text) } : null,
        polledAt: snap.polledAt
    };
}

/** Press one of those controls. XLink's own warnings come back as { confirm } until confirmed. */
async function cabinetAction(req) {
    const c = cabinetOf(String(req.cabinet || ''));
    if (!c.xlink) throw fail('This cabinet has no XLink device', 'QUICKCAST_NO_XLINK');
    const pth = Array.isArray(req.path) ? req.path.map(Number) : [];
    const snap = await xlink.device(c.xlink, {});
    const top = snap.items[pth[0]];
    const ok = top && (
        (pth.length === 1 && req.op === 'toggle' && (XL_VIDEO.test(top.text) || XL_POWER.test(top.text)))
        || (pth.length === 2 && req.op === 'send' && ((XL_VIDEO.test(top.text) && top.children[pth[1]] && XL_RESET.test(top.children[pth[1]].text)) || XL_GAME.test(top.text))));
    if (!ok) throw fail('QuickCast can only use the video, encoder, power and game controls', 'QUICKCAST_XLINK_DENIED');
    const t0 = Date.now();
    let r;
    try { r = await xlink.action({ device: c.xlink, path: pth, op: req.op, value: req.value, confirmed: !!req.confirmed }); } catch (e) { logXlink('control', c, { path: pth, op: req.op, value: req.value }, null, t0); throw e; }
    logXlink('control', c, { path: pth, op: req.op, value: req.value }, r, t0);
    if (r.confirm) return { confirm: r.confirm };
    return { ok: r.ok, code: r.code, failure: r.failure, controls: await cabinetControls(c.id) };
}

/**
 * The cabinet's whole XLink menu for the front panel's XLINK key: the item tree (text, kind, toggle
 * options with the active one, status, warning flag, children), without the endpoint URLs.
 */
async function cabinetXlinkMenu(cabinetId, force) {
    const c = cabinetOf(cabinetId);
    if (!c.xlink) return { cabinet: c.id, available: false };
    let snap;
    try { snap = await xlink.device(c.xlink, { force: !!force }); } catch (e) {
        if (e.code === 'XLINK_NO_DEVICE' || e.code === 'XLINK_NO_MENU') return { cabinet: c.id, available: false };
        throw e;
    }
    const strip = (it) => ({
        text: it.text, kind: it.kind, warning: !!it.warning, append: it.append || '',
        status: it.status ? { text: it.status.text, color: it.status.color, failed: !!it.status.failed } : null,
        toggle: it.toggle ? it.toggle.map((b) => ({ label: b.label, active: !!b.active })) : null,
        children: (it.children || []).map(strip)
    });
    return { cabinet: c.id, available: true, device: { key: snap.key, name: snap.name, status: snap.status ? { text: snap.status.text, color: snap.status.color } : null }, items: snap.items.map(strip), polledAt: snap.polledAt };
}

/** One log line per cabinet command VisionCaster sends (so a "nothing happened" can be traced). */
function logXlink(what, c, req, r, t0) {
    const sent = (r && r.log || []).find((l) => l.verb === 'SEND' || l.verb === 'SET');
    const where = sent ? String(sent.url).replace(/^[^/]*/, '') : '';
    const res = !r ? 'ERROR' : r.confirm ? `WARNING ${r.confirm.header}` : r.ok ? `OK ${sent ? sent.code : ''}` : `FAILED ${sent ? sent.code : ''} ${String(r.failure || '').slice(0, 80)}`;
    console.log(`[visioncaster] ${what} ${c.id} path ${JSON.stringify(req.path)} ${req.op}${req.value != null ? ` ${req.value}` : ''} -> ${res}${where ? ` (${where})` : ''} ${Date.now() - t0} ms`);
}

/** Run any XLink item of the cabinet (send / toggle / slider); XLink's own warnings come back as { confirm }. */
async function cabinetXlinkDo(req) {
    const c = cabinetOf(String(req.cabinet || ''));
    if (!c.xlink) throw fail('This cabinet has no XLink device', 'QUICKCAST_NO_XLINK');
    const pth = Array.isArray(req.path) ? req.path.map(Number) : [];
    const op = ['send', 'toggle', 'slider'].includes(req.op) ? req.op : 'send';
    const t0 = Date.now();
    let r;
    try { r = await xlink.action({ device: c.xlink, path: pth, op, value: req.value, confirmed: !!req.confirmed }); } catch (e) { logXlink('xlink', c, { path: pth, op, value: req.value }, null, t0); throw e; }
    logXlink('xlink', c, { path: pth, op, value: req.value }, r, t0);
    if (r.confirm) return { confirm: r.confirm };
    // xlink.action already re-read the device: answer with that, never a second full read
    return { ok: r.ok, code: r.code, failure: r.failure, menu: await cabinetXlinkMenu(c.id, false) };
}

/**
 * Start the satellite's engine without picking a cabinet. Answers at once: the start (and any stuck-engine
 * restart) can take a couple of minutes, its progress is on the front panel (status obs.launchStep) and a
 * failure is obs.launchError, so no request sits open in the client's ticker meanwhile.
 */
async function launch() {
    touch();
    if (link.online) return { ok: true, already: true };
    launchError = '';
    void ensureObs(true).then(() => { launchError = ''; }).catch((e) => {
        launchError = e.message;
        console.warn(`[visioncaster] satellite engine start failed: ${e.message}`);
    });
    return { ok: true, starting: true };
}

let stopping = false;

/**
 * OBS POWER OFF on the satellite: close OBS gracefully with the on-demand Ruiko task launch.stopTask
 * (taskkill without /F, run in the logged-on session: a taskkill over SSH cannot reach OBS's window).
 * Refused while streaming or recording.
 */
/**
 * Satellite power off, like the hardware: its SHUTDOWN screen goes up on its output, a live broadcast is
 * ended (stream stopped, YouTube broadcast completed), recording / replay buffer / virtual camera are
 * stopped, the outputs get FLUSH_MS to drain, then the Ruiko stop task closes OBS (graceful, forced after
 * 12 s if a prompt or the tray keeps it open).
 */
const FLUSH_MS = 5000;
async function powerOff() {
    return exclusive('shutting down the encoder engine', async () => {
        touch();
        const step = (text, done) => avOsd.shutdownStep('sat', text, done);
        stopping = true;
        try {
            if (link.online) {
                step('SHUTDOWN REQUESTED');
                const st = await link.request('GetStreamStatus').catch(() => ({}));
                if (st.outputActive) {
                    step('ENDING BROADCAST');
                    await link.request('StopStream').catch(() => {});
                    await link.waitFor('StreamStateChanged', (d) => !d.outputActive, 15000);
                    try { await yt.endBroadcast(); } catch (_) { /* YouTube ends it itself */ }
                }
                step('STOPPING RECORDING');
                const rec = await link.request('GetRecordStatus').catch(() => ({}));
                if (rec.outputActive) { await link.request('StopRecord').catch(() => {}); await link.waitFor('RecordStateChanged', (d) => !d.outputActive, 15000); }
                const rb = await link.request('GetReplayBufferStatus').catch(() => ({}));
                if (rb.outputActive) await link.request('StopReplayBuffer').catch(() => {});
                const vc = await link.request('GetVirtualCamStatus').catch(() => ({}));
                if (vc.outputActive) await link.request('StopVirtualCam').catch(() => {});
                step('FLUSHING OUTPUTS');
                await new Promise((res) => setTimeout(res, FLUSH_MS));
                step('POWERING DOWN');
                await new Promise((res) => setTimeout(res, 1500)); // the last OSD frame reaches the outputs
            }
            if (await ENGINE_RUNNING() === false) { link.close(); engineHung = false; return { ok: true, already: true }; }
            await runStopTask(40000);
            engineHung = false;
            link.close();
            lastTry = Date.now() + 3000; // no reconnect attempt while it winds down
            console.log(`[visioncaster] satellite ${satelliteName()} powered off`);
            return { ok: true };
        } finally { stopping = false; step('', true); }
    });
}

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** Save the YouTube stream key (and optionally the watch URL). The key is never read back. */
function setKey(key, watchUrl) {
    const raw = readRawConfig();
    raw.youtube = raw.youtube || {};
    if (key !== undefined && key !== null) {
        const k = String(key).trim();
        if (k && !KEY_RE.test(k)) throw fail('That does not look like a YouTube stream key', 'QUICKCAST_BAD_KEY');
        raw.youtube.streamKey = k;
    }
    if (watchUrl !== undefined && watchUrl !== null) {
        const u = String(watchUrl).trim();
        if (u && !/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|studio\.youtube\.com)\//i.test(u)) throw fail('The watch link must be a youtube.com link', 'QUICKCAST_BAD_URL');
        raw.youtube.watchUrl = u;
    }
    writeRawConfig(raw);
    const cfg = readConfig();
    return { ok: true, key: { set: !!cfg.youtube.streamKey, hint: keyHint(cfg.youtube.streamKey) }, watchUrl: cfg.youtube.watchUrl };
}

function info() {
    const cfg = readConfig();
    return { host: cfg.obs.host, port: cfg.obs.port, profile: cfg.profile, collection: cfg.collection, server: cfg.youtube.server, launchTask: cfg.launch.task };
}

module.exports = { cabinetXlinkMenu, cabinetXlinkDo, liveTicket, liveStream, osd: avOsd, status, preview, prepare, goLive, stop, launch, powerOff, setKey, info, getEncoder, setEncoder, cabinetControls, cabinetAction, setMute, youtube: yt, _link: link, _readConfig: readConfig, _ps: ps, DATA_DIR };
