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
 *                   launch: { ssh, task } }      every field optional (DEFAULTS below)
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
        { id: 'h2h', name: 'Chunithm H2H', scene: 'Chuni H2H', icon: 'h2h', short: 'H2H' }
    ],
    launch: { ssh: 'ruiko', task: '\\AmusementVISION\\QuickCast OBS' }
};

const CONNECT_TIMEOUT_MS = 4000;
const REQUEST_TIMEOUT_MS = 10000;
const LEASE_MS = 60000;
const LAUNCH_WAIT_MS = 60000;
const SWITCH_WAIT_MS = 20000;
const START_WAIT_MS = 15000;
const AUDIO_SET_TTL_MS = 5000;
const NOT_READY_WAIT_MS = 45000;
// obs-websocket EventSubscription: General | Config | Scenes | Inputs | Outputs | SceneItems, + InputVolumeMeters
const EVENTS = 1 | 2 | 4 | 8 | 64 | 128 | (1 << 16);

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
            .map((c) => ({ id: String(c.id), name: String(c.name || c.id), scene: String(c.scene), icon: String(c.icon || c.id), short: String(c.short || c.name || c.id).slice(0, 3).toUpperCase() })),
        launch: { ...DEFAULTS.launch, ...(raw.launch || {}) }
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
    constructor() {
        this.ws = null;
        this.ready = null;      // Promise while connecting / connected
        this.pending = new Map();
        this.seq = 0;
        this.version = '';
        this.listeners = new Set();
        this.meters = new Map(); // inputName -> { mag: [], peak: [], at }
        this.lastError = '';
    }

    get online() { return !!(this.ws && this.ws.readyState === WebSocket.OPEN && this.identified); }

    connect() {
        if (this.ready) return this.ready;
        const cfg = readConfig().obs;
        this.identified = false;
        this.ready = new Promise((resolve, reject) => {
            let settled = false;
            const done = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (err) { this.lastError = err.message; this.close(); reject(err); } else { this.lastError = ''; resolve(); }
            };
            const timer = setTimeout(() => done(fail('OBS is not answering on Ruiko (not running?)', 'QUICKCAST_OBS_TIMEOUT')), CONNECT_TIMEOUT_MS);
            let ws;
            try {
                ws = new WebSocket(`ws://${cfg.host}:${Number(cfg.port) || 4455}`, 'obswebsocket.json', { handshakeTimeout: CONNECT_TIMEOUT_MS, maxPayload: 64 * 1024 * 1024 });
            } catch (e) { done(e); return; }
            this.ws = ws;
            ws.on('error', (e) => {
                const refused = e && (e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT');
                done(fail(refused ? 'OBS is not running on Ruiko' : `OBS connection failed: ${e.message}`, refused ? 'QUICKCAST_OBS_DOWN' : 'QUICKCAST_OBS_ERROR'));
            });
            ws.on('close', (code, reason) => {
                done(fail(code === 4009 ? 'OBS refused the websocket password' : 'OBS closed the connection', code === 4009 ? 'QUICKCAST_OBS_AUTH' : 'QUICKCAST_OBS_DOWN'));
                if (this.ws === ws) this.close();
                void reason;
            });
            ws.on('message', (buf) => {
                let msg;
                try { msg = JSON.parse(buf.toString('utf8')); } catch (_) { return; }
                const d = msg.d || {};
                if (msg.op === 0) { // Hello
                    this.version = d.obsWebSocketVersion || '';
                    const ident = { rpcVersion: 1, eventSubscriptions: EVENTS };
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
        for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(fail('OBS connection closed', 'QUICKCAST_OBS_DOWN')); }
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
            const timer = setTimeout(() => { this.pending.delete(requestId); reject(fail(`OBS did not answer ${requestType}`, 'QUICKCAST_OBS_TIMEOUT')); }, timeoutMs || REQUEST_TIMEOUT_MS);
            this.pending.set(requestId, { resolve, reject, timer });
            try { this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } })); } catch (e) { clearTimeout(timer); this.pending.delete(requestId); reject(e); }
        });
    }

    onEvent(type, data) {
        if (type === 'InputVolumeMeters') {
            const now = Date.now();
            for (const inp of data.inputs || []) {
                const lv = Array.isArray(inp.inputLevelsMul) ? inp.inputLevelsMul : [];
                let m = this.meters.get(inp.inputName);
                if (!m) { m = { mag: [], peak: [], at: now }; this.meters.set(inp.inputName, m); }
                lv.forEach((ch, i) => {
                    m.mag[i] = Math.max(m.mag[i] || 0, Number(ch[0]) || 0);
                    m.peak[i] = Math.max(m.peak[i] || 0, Number(ch[1]) || 0);
                });
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

    /** The meters since the last read (peaks), then reset. */
    takeMeters() {
        const out = new Map();
        const now = Date.now();
        for (const [name, m] of this.meters) {
            if (now - m.at > 2000) { this.meters.delete(name); continue; }
            out.set(name, { mag: m.mag.slice(0, m.channels || m.mag.length), peak: m.peak.slice(0, m.channels || m.peak.length) });
            m.mag = []; m.peak = [];
        }
        return out;
    }
}

const link = new ObsLink();
let leaseTimer = null;
let launching = null;        // Promise while OBS is being started
let launchStartedAt = 0;
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

/** Start OBS with the Ruiko task, then wait until its websocket answers. */
function launchObs() {
    if (launching) return launching;
    launching = (async () => {
        launchStartedAt = Date.now();
        const task = readConfig().launch.task;
        const list = await sshRun('tasklist /FI "IMAGENAME eq obs64.exe" /NH');
        const already = list.ok && /obs64\.exe/i.test(list.out);
        if (!already) {
            if (!/^[\\\w .-]+$/.test(task)) throw fail('The launch task name is not valid', 'QUICKCAST_LAUNCH');
            const r = await sshRun(`schtasks /Run /TN "${task}"`);
            if (!r.ok || !/SUCCESS/i.test(r.out)) throw fail(`Could not start OBS on Ruiko: ${(r.err || r.out).trim().slice(0, 200)}`, 'QUICKCAST_LAUNCH');
        }
        const until = Date.now() + LAUNCH_WAIT_MS;
        for (;;) {
            try { await link.connect(); return true; } catch (e) {
                if (e.code === 'QUICKCAST_OBS_AUTH') throw e;
                if (Date.now() > until) throw fail(already ? 'OBS is running on Ruiko but its websocket server does not answer (Tools > WebSocket Server Settings)' : 'OBS did not come up on Ruiko within a minute', 'QUICKCAST_LAUNCH');
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
    })().finally(() => { launching = null; });
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
    if (!(r.sceneCollections || []).includes(want)) throw fail(`OBS has no scene collection "${want}"`, 'QUICKCAST_NO_COLLECTION');
    const changed = link.waitFor('CurrentSceneCollectionChanged', (d) => d.sceneCollectionName === want, SWITCH_WAIT_MS);
    await link.request('SetCurrentSceneCollection', { sceneCollectionName: want }, SWITCH_WAIT_MS);
    await changed;
    return true;
}

async function ensureProfile() {
    const want = readConfig().profile;
    const r = await link.request('GetProfileList');
    if (r.currentProfileName === want) return false;
    if (!(r.profiles || []).includes(want)) throw fail(`OBS has no profile "${want}"`, 'QUICKCAST_NO_PROFILE');
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

/** Everything the client shows, one read per poll (~8 Hz). Never throws for an offline OBS. */
async function status() {
    touch();
    const cfg = readConfig();
    const base = {
        busy,
        obs: { state: launching ? 'launching' : 'offline', version: link.version, error: link.lastError, launchingFor: launching ? Date.now() - launchStartedAt : 0 },
        cabinets: cfg.cabinets.map((c) => ({ id: c.id, name: c.name, scene: c.scene, icon: c.icon, short: c.short, present: false })),
        key: { set: !!cfg.youtube.streamKey, hint: keyHint(cfg.youtube.streamKey) },
        watchUrl: cfg.youtube.watchUrl || '',
        want: { profile: cfg.profile, collection: cfg.collection },
        youtube: { account: yt.account(), last: yt.lastSettings(), broadcast: yt.broadcastInfo() }
    };
    if (!link.online) {
        if (launching || Date.now() - lastTry < 2000) return base;
        lastTry = Date.now();
        try { await link.connect(); } catch (_) { base.obs.error = link.lastError; return base; }
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
    } catch (e) {
        base.obs.error = e.message;
        if (!link.online) base.obs.state = 'offline';
    }
    return base;
}

/** A JPEG of the cabinet's scene (what goes on air with it), as a data URL. */
async function preview(cabinetId, width) {
    touch();
    if (!link.online) throw fail('OBS is not connected', 'QUICKCAST_OBS_DOWN');
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
        if (!(scenes.scenes || []).some((s) => s.sceneName === c.scene)) throw fail(`The scene "${c.scene}" is missing from OBS`, 'QUICKCAST_NO_SCENE');
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
    if (!cfg.youtube.streamKey) throw fail('No YouTube stream key is set (Stream > Stream Key...)', 'QUICKCAST_NO_KEY');
    return exclusive('going live', async () => {
        await ensureObs(true);
        const st = await link.request('GetStreamStatus');
        if (st.outputActive) return { ok: true, already: true };
        await ensureCollection();
        const prof = await link.request('GetProfileList');
        if (prof.currentProfileName !== cfg.profile) {
            const rec = await link.request('GetRecordStatus').catch(() => ({}));
            if (rec.outputActive) throw fail(`OBS is recording in the "${prof.currentProfileName}" profile. Stop the recording on Ruiko first.`, 'QUICKCAST_RECORDING');
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
                ? 'OBS could not connect to YouTube. Check the stream key and Ruiko\'s network (OBS shows the reason on Ruiko).'
                : 'OBS did not start streaming within 15 seconds', 'QUICKCAST_START_FAILED');
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
        if (after.outputActive) throw fail('OBS is still streaming', 'QUICKCAST_STOP_FAILED');
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
        if (rec.outputActive) throw fail('OBS is recording; stop the recording on Ruiko first', 'QUICKCAST_RECORDING');
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
        if (!/written/.test(w.out)) throw fail(`Could not write the encoder settings on Ruiko: ${(w.err || w.out).trim().slice(0, 200)}`, 'QUICKCAST_ENCODER');
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

/** Start OBS on Ruiko without picking a cabinet. */
async function launch() {
    touch();
    if (link.online) return { ok: true, already: true };
    await ensureObs(true);
    return { ok: true };
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

module.exports = { status, preview, prepare, goLive, stop, launch, setKey, info, getEncoder, setEncoder, youtube: yt, _link: link, _readConfig: readConfig, _ps: ps, DATA_DIR };
