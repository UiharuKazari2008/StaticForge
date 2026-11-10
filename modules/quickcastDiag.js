/**
 * QuickCast pipeline diagnostics (Yozora #734): where a bad broadcast goes wrong, stage by stage.
 *
 * The system: each cabinet has a mixer / muxer PC (OBS, e.g. PLG-EAST-1) that captures the game and
 * cameras, mixes them and sends one NDI feed; the satellite encoder (OBS on Ruiko) takes that feed,
 * does the heavy encoding and streams to YouTube. Two rows come out of here:
 *
 *   input   (the cabinet's mux PC, over its own obs-websocket, stats only):
 *           CAPTURE  capture devices in its program scene (a card with no signal reports a 0x0 size)
 *           MIXER    render fps / frame time / frames skipped for rendering lag (GPU)
 *           NDI OUT  the NDI output's frame rate, frames skipped for output lag, CPU (NDI is CPU-coded)
 *           LINK     how fast its OBS answers from here (LAN health), timeouts
 *   output  (OBS on Ruiko):
 *           NDI RX   the cabinet's NDI source on Ruiko has a picture (0x0 = nothing arriving)
 *           RENDER   Ruiko's render lag
 *           ENCODER  frames skipped for encoding lag
 *           NETWORK  frames dropped on the RTMPS connection, congestion, bitrate
 *           YOUTUBE  YouTube's ingest health (signed in, QuickCast's own broadcast)
 *
 * Percentages are over the last WINDOW_MS. A mux is only asked while the QuickCast window polls, at
 * most every MUX_SAMPLE_MS, and only cheap requests (GetStats, GetOutputStatus, scene item lists):
 * never screenshots, which cost a busy mux PC frames (Nov 10).
 *
 * Which mux sends a cabinet's feed comes from the NDI source in the cabinet's scene on Ruiko
 * ("PLG-EAST-1 (Mux Output 1)" -> machine PLG-EAST-1), looked up in config.muxes
 * ({ "PLG-EAST-1": { host, port, password } }), else by DNS name.
 */
'use strict';

const dns = require('dns');

const WINDOW_MS = 10000;
const MUX_SAMPLE_MS = 1000;
const MUX_SCAN_MS = 5000;
const RX_SCAN_MS = 2000;
const MUX_LEASE_MS = 60000;
const MUX_TIMEOUT_MS = 3000;
const CAPTURE_DETAIL_MS = 15000;

const CAPTURE_KINDS = new Set([
    'dshow_input', 'monitor_capture', 'window_capture', 'game_capture', 'wasapi_process_output_capture',
    'av_capture_input', 'av_capture_input_v2', 'v4l2_input', 'decklink-input', 'ndi_source', 'screen_capture', 'xcomposite_input'
]);

let deps = null; // { makeLink(target, label), ruiko: ObsLink, readConfig() }
let restartHook = null;
function onUnitRestart(fn) { restartHook = fn; }

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => (b > 0 ? round1((a / b) * 100) : 0);

/** A rolling window of counter samples: rate(k) = Δk/Δt per second, share(a, b) = Δa/Δb in %. */
class Window {
    constructor() { this.s = []; }
    add(sample) {
        const now = Date.now();
        const last = this.s[this.s.length - 1];
        if (last && now - last.at < 400) return;
        // a counter went backwards: OBS restarted (RESET ENC), start over
        if (last && Object.keys(sample).some((k) => typeof sample[k] === 'number' && sample[k] < (last[k] || 0))) this.s = [];
        this.s.push({ at: now, ...sample });
        while (this.s.length > 2 && now - this.s[0].at > WINDOW_MS) this.s.shift();
    }
    span() { return this.s.length > 1 ? this.s[this.s.length - 1].at - this.s[0].at : 0; }
    delta(k) { return this.s.length > 1 ? (this.s[this.s.length - 1][k] || 0) - (this.s[0][k] || 0) : 0; }
    rate(k) { const t = this.span(); return t > 0 ? (this.delta(k) * 1000) / t : null; }
    share(a, b) { return this.s.length > 1 ? pct(this.delta(a), this.delta(b)) : null; }
    reset() { this.s = []; }
}

function init(d) { deps = d; }

/** Worst first: bad, warn, wait, ok, off. */
const RANK = { bad: 0, warn: 1, wait: 2, ok: 3, off: 4 };
const lagState = (p, warnAt = 0.5, badAt = 2) => (p == null ? 'wait' : p >= badAt ? 'bad' : p >= warnAt ? 'warn' : 'ok');
const worst = (...st) => st.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), 'off');

// ------------------------------------------------------------------ the cabinet's feed on Ruiko

const feeds = new Map(); // scene -> { at, inputs: [{ name, ndiName, width, height, active }], pending }

/** The enabled NDI sources in a cabinet scene on Ruiko (groups / nested scenes too), with their size. */
async function scanFeed(scene) {
    const link = deps.ruiko;
    const out = [];
    const seen = new Set();
    const walk = async (name, group) => {
        if (seen.has(name)) return;
        seen.add(name);
        let items = [];
        try { items = (await link.request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName: name }, MUX_TIMEOUT_MS)).sceneItems || []; } catch (_) { return; }
        for (const it of items) {
            if (!it.sceneItemEnabled) continue;
            if (it.isGroup) await walk(it.sourceName, true);
            else if (it.sourceType === 'OBS_SOURCE_TYPE_SCENE') await walk(it.sourceName, false);
            else if (it.inputKind === 'ndi_source') {
                const tr = it.sceneItemTransform || {};
                out.push({ name: it.sourceName, width: tr.sourceWidth || 0, height: tr.sourceHeight || 0 });
            }
        }
    };
    await walk(scene, false);
    for (const f of out) {
        try { f.ndiName = String(((await link.request('GetInputSettings', { inputName: f.name }, MUX_TIMEOUT_MS)).inputSettings || {}).ndi_source_name || ''); } catch (_) { f.ndiName = ''; }
        try { f.active = !!(await link.request('GetSourceActive', { sourceName: f.name }, MUX_TIMEOUT_MS)).videoActive; } catch (_) { f.active = null; }
    }
    return out;
}

function feedFor(scene) {
    let f = feeds.get(scene);
    if (!f) { f = { at: 0, inputs: null, pending: null }; feeds.set(scene, f); }
    if (!f.pending && Date.now() - f.at > RX_SCAN_MS && deps.ruiko.online) {
        f.pending = scanFeed(scene).then((inputs) => { f.inputs = inputs; f.at = Date.now(); }).catch(() => { f.at = Date.now(); }).finally(() => { f.pending = null; });
    }
    return f.inputs;
}

/** "PLG-EAST-1 (Mux Output 1)" -> { machine: "PLG-EAST-1", stream: "Mux Output 1" } */
function splitNdi(name) {
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(String(name || ''));
    return m ? { machine: m[1], stream: m[2] } : { machine: String(name || ''), stream: '' };
}

// ------------------------------------------------------------------ mux PCs

const muxes = new Map(); // machine -> state

function muxTarget(machine) {
    const cfg = deps.readConfig();
    const table = cfg.muxes || {};
    const key = Object.keys(table).find((k) => k.toLowerCase() === machine.toLowerCase());
    return key ? { host: String(table[key].host || ''), port: Number(table[key].port) || 4455, password: String(table[key].password || '') } : null;
}

function muxState(machine) {
    let m = muxes.get(machine);
    if (m) return m;
    m = {
        machine, target: muxTarget(machine), resolving: null, link: null, pending: null, lastSample: 0, lastScan: 0, askedAt: 0,
        win: new Window(), rtt: [], timeouts: 0, error: '', stats: null, video: null, ndiOut: null, outputs: null, program: '', captures: null, lease: null
    };
    muxes.set(machine, m);
    if (!m.target) {
        // not in config.muxes: try the NDI machine name as a host name
        m.resolving = new Promise((resolve) => dns.lookup(machine, { family: 4 }, (err, addr) => {
            if (!err && addr) m.target = { host: addr, port: 4455, password: '' };
            else m.error = `${machine} is not in QuickCast's mux list (config.json "muxes") and has no DNS name`;
            m.resolving = null;
            resolve();
        }));
    }
    return m;
}

async function scanMux(m) {
    const link = m.link;
    const outs = (await link.request('GetOutputList', {}, MUX_TIMEOUT_MS)).outputs || [];
    m.outputs = outs.filter((o) => o.outputKind === 'ndi_output').map((o) => ({ name: o.outputName, active: !!o.outputActive }));
    const ndi = m.outputs.find((o) => o.active) || m.outputs[0] || null;
    m.ndiOutName = ndi ? ndi.name : '';
    m.video = await link.request('GetVideoSettings', {}, MUX_TIMEOUT_MS);
    m.program = (await link.request('GetCurrentProgramScene', {}, MUX_TIMEOUT_MS)).currentProgramSceneName || '';
    const caps = [];
    const seen = new Set();
    const walk = async (name, group) => {
        if (seen.has(name)) return;
        seen.add(name);
        let items = [];
        try { items = (await link.request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName: name }, MUX_TIMEOUT_MS)).sceneItems || []; } catch (_) { return; }
        for (const it of items) {
            if (!it.sceneItemEnabled) continue;
            if (it.isGroup) await walk(it.sourceName, true);
            else if (it.sourceType === 'OBS_SOURCE_TYPE_SCENE') await walk(it.sourceName, false);
            else if (CAPTURE_KINDS.has(it.inputKind)) {
                const tr = it.sceneItemTransform || {};
                caps.push({ name: it.sourceName, kind: it.inputKind, width: tr.sourceWidth || 0, height: tr.sourceHeight || 0 });
            }
        }
    };
    if (m.program) await walk(m.program, false);
    // per input: the capture's own frame rate, buffering, and any delay set on it (camera vs game sync)
    const old = new Map((m.captures || []).map((c) => [c.name, c]));
    const detailDue = Date.now() - (m.lastDetail || 0) > CAPTURE_DETAIL_MS;
    await Promise.all(caps.map(async (c) => {
        const prev = old.get(c.name);
        if (!detailDue && prev && prev.settingsAt) { Object.assign(c, { fps: prev.fps, buffering: prev.buffering, delayMs: prev.delayMs, syncMs: prev.syncMs, settingsAt: prev.settingsAt }); return; }
        const [set, filters, sync] = await Promise.all([
            link.request('GetInputSettings', { inputName: c.name }, MUX_TIMEOUT_MS).catch(() => null),
            link.request('GetSourceFilterList', { sourceName: c.name }, MUX_TIMEOUT_MS).catch(() => null),
            link.request('GetInputAudioSyncOffset', { inputName: c.name }, MUX_TIMEOUT_MS).catch(() => null)
        ]);
        const is = (set && set.inputSettings) || {};
        // dshow: res_type 1 = custom; frame_interval in 100 ns units; buffering 0 auto / 1 on / 2 off
        if (c.kind === 'dshow_input') {
            c.fps = Number(is.res_type) === 1 && Number(is.frame_interval) > 0 ? Math.round(1e9 / Number(is.frame_interval)) / 100 : null;
            c.buffering = is.buffering == null ? 'auto' : ['auto', 'on', 'off'][Number(is.buffering)] || 'auto';
        }
        c.delayMs = ((filters && filters.filters) || []).filter((f) => f.filterEnabled && f.filterKind === 'async_delay_filter')
            .reduce((a, f) => a + (Number((f.filterSettings || {}).delay_ms) || 0), 0);
        c.syncMs = sync && sync.inputAudioSyncOffset != null ? Number(sync.inputAudioSyncOffset) : null;
        c.settingsAt = Date.now();
    }));
    if (detailDue) m.lastDetail = Date.now();
    m.captures = caps;
    m.lastScan = Date.now();
}

async function sampleMux(m) {
    if (m.resolving) await m.resolving;
    if (!m.target) return;
    if (!m.link) m.link = deps.makeLink(() => m.target, m.machine);
    const link = m.link;
    try {
        await link.connect(); // the round trip below is OBS answering, not the connect
        const t0 = Date.now();
        const stats = await link.requestOnce('GetStats', {}, MUX_TIMEOUT_MS);
        const rtt = Date.now() - t0;
        m.rtt.push(rtt);
        if (m.rtt.length > 10) m.rtt.shift();
        if (Date.now() - m.lastScan > MUX_SCAN_MS) await scanMux(m);
        let out = null;
        if (m.ndiOutName) { try { out = await link.requestOnce('GetOutputStatus', { outputName: m.ndiOutName }, MUX_TIMEOUT_MS); } catch (_) { out = null; } }
        // a unit that came back up (its frame counter restarted, or the link was down): power-on self test
        if (restartHook && ((m.stats && (stats.renderTotalFrames || 0) < (m.stats.renderTotalFrames || 0)) || (m.wasDown && (stats.renderTotalFrames || 0) < 60 * 120))) {
            try { restartHook(m.machine); } catch (_) { /* hook's own problem */ }
        }
        m.wasDown = false;
        m.stats = stats;
        m.ndiOut = out;
        m.win.add({
            renderSkipped: stats.renderSkippedFrames || 0, renderTotal: stats.renderTotalFrames || 0,
            outSkipped: stats.outputSkippedFrames || 0, outTotal: stats.outputTotalFrames || 0,
            ndiFrames: out ? out.outputTotalFrames || 0 : 0, ndiSkipped: out ? out.outputSkippedFrames || 0 : 0
        });
        m.timeouts = 0;
        m.error = '';
    } catch (e) {
        m.timeouts++;
        m.error = e.message;
        if (!link.online) { m.win.reset(); m.stats = null; m.wasDown = true; }
    }
}

function askMux(machine) {
    const m = muxState(machine);
    m.askedAt = Date.now();
    clearTimeout(m.lease);
    m.lease = setTimeout(() => { if (m.link) m.link.close(); m.win.reset(); m.stats = null; }, MUX_LEASE_MS);
    if (m.lease.unref) m.lease.unref();
    if (!m.pending && Date.now() - m.lastSample >= MUX_SAMPLE_MS) {
        m.lastSample = Date.now();
        m.pending = sampleMux(m).finally(() => { m.pending = null; });
    }
    return m;
}

// ------------------------------------------------------------------ rows

/** Both rows share one column grid so matching parts read down a line:
 *  SOURCE | CLOCK | PROCESS | ENCODE | TRANSPORT | DESTINATION */
const COLUMNS = ['SOURCE', 'CLOCK', 'PROCESS', 'ENCODE', 'TRANSPORT', 'DESTINATION'];
const COL = { capture: 0, rx: 0, clock: 1, mixer: 2, render: 2, ndiout: 3, encoder: 3, link: 4, network: 4, lock: 5, youtube: 5 };

/** blink: a timing / clock problem (frame rates that cannot lock, a clock not held), shown flashing. */
function stage(id, label, state, value, detail, blink) { return { id, col: COL[id], label, state, value: value || '', detail: detail || '', blink: !!blink }; }

/** a:b as a lock ratio when one rate is a whole multiple of the other, else null */
function lockRatio(src, dst) {
    if (!src || !dst) return null;
    const near = (x) => Math.abs(x - Math.round(x)) < 0.0002 * Math.max(1, x);
    if (near(dst / src)) return `1:${Math.round(dst / src)}`;
    if (near(src / dst)) return `${Math.round(src / dst)}:1`;
    return null;
}
const fmtFps = (f) => (Math.abs(f - Math.round(f)) < 0.005 ? String(Math.round(f)) : f.toFixed(2));

function inputRow(cabinet, feed, satFps) {
    const ndi = feed && feed.find((f) => f.ndiName);
    if (!cabinet) return { source: '', stages: [], note: 'Pick a cabinet.' };
    if (!feed) return { source: '', stages: [], note: 'Looking for the cabinet\'s NDI feed...' };
    if (!ndi) return { source: '', stages: [], note: `The "${cabinet.scene}" scene on Ruiko has no NDI feed, so there is no mux PC to check.` };
    const { machine, stream } = splitNdi(ndi.ndiName);
    const m = askMux(machine);
    const source = machine;
    const sourceDetail = `NDI "${ndi.ndiName}" (satellite input "${ndi.name}")${m.target ? `, control ${m.target.host}:${m.target.port}` : ''}`;
    if (!m.target) return { source, sourceDetail, stages: [], note: m.resolving ? `Finding ${machine}...` : m.error };
    if (!m.stats) {
        const st = m.timeouts ? 'bad' : 'wait';
        return {
            source, sourceDetail,
            stages: [stage('link', 'LINK', st, m.timeouts ? 'NO ANSWER' : '...', m.timeouts ? `${machine} (control ${m.target.host}:${m.target.port}) is not answering: ${m.error}. The unit may be powered off, or its mixer engine not running.` : 'Connecting')],
            note: ''
        };
    }
    const s = m.stats;
    const v = m.video || {};
    const fps = v.fpsDenominator ? v.fpsNumerator / v.fpsDenominator : 0;
    const budget = fps ? 1000 / fps : 0;
    const w = m.win;

    // CAPTURE
    const caps = m.captures || [];
    const dead = caps.filter((c) => !c.width || !c.height);
    // an input whose frame rate does not divide into the mux's judders and slides against the others
    const fits = (a, b) => Math.abs(a / b - Math.round(a / b)) < 0.0002; // 59.94 into 60 is 0.1% off: a frame every ~17 s
    const odd = caps.filter((c) => c.fps && fps && !fits(fps, c.fps) && !fits(c.fps, fps));
    const buffered = caps.filter((c) => c.buffering === 'on');
    const capState = !caps.length ? 'off' : dead.length ? 'bad' : odd.length || buffered.length ? 'warn' : 'ok';
    const capLine = (c) => {
        const bits = [`${c.width}x${c.height}`];
        bits.push(c.fps ? `${c.fps} fps target` : c.kind === 'dshow_input' ? 'device default fps' : '');
        if (c.buffering) bits.push(`buffering ${c.buffering}`);
        if (c.delayMs) bits.push(`video delay ${c.delayMs} ms`);
        if (c.syncMs) bits.push(`audio sync ${c.syncMs} ms`);
        const issue = [
            !c.width || !c.height ? 'NO SIGNAL' : '',
            odd.includes(c) ? `${c.fps} fps does not fit ${round1(fps)} fps: judder / drift` : '',
            c.buffering === 'on' ? 'buffering adds delay' : ''
        ].filter(Boolean).join('; ');
        return `${c.width && c.height && !issue ? '✓' : '✗'} ${c.name} (${c.kind}): ${bits.filter(Boolean).join(', ')}${issue ? ` — ${issue}` : ''}`;
    };
    const capDetail = caps.length
        ? `Capture inputs on ${machine}'s program scene "${m.program}" (mux runs ${round1(fps)} fps):\n${caps.map(capLine).join('\n')}`
            + (dead.length ? '\n\nA 0x0 input has no signal: check its cable, the device, or that the game PC outputs video.' : '')
            + (odd.length ? '\n\nA capture at a rate that does not divide into the mux rate (59.94 into 60, 25 into 30) repeats or drops frames unevenly and slides against the other inputs.' : '')
            + (buffered.length ? '\n\nBuffering on = the mixer holds frames to smooth them: smoother, but that input runs behind the others.' : '')
        : `No capture inputs on "${m.program}"`;
    const capVal = !caps.length ? 'NONE' : dead.length ? `${dead.length} NO SIGNAL` : odd.length ? `${odd.length} FPS MISMATCH` : buffered.length ? `${buffered.length} BUFFERED` : `${caps.length} LIVE`;

    // MIXER (render)
    const rLag = w.share('renderSkipped', 'renderTotal');
    const ms = round1(s.averageFrameRenderTime || 0);
    const active = round1(s.activeFps || 0);
    let mixState = lagState(rLag);
    if (budget && ms > budget * 0.9) mixState = worst(mixState, 'warn');
    if (fps && active < fps * 0.9) mixState = worst(mixState, 'bad');
    const mixClock = !!(fps && active < fps * 0.97); // the mux is not holding its own clock
    const mixDetail = `${machine} renders ${active} of ${round1(fps)} fps; average frame ${ms} ms of a ${round1(budget)} ms budget; ${rLag == null ? '-' : `${rLag}%`} of frames skipped for rendering lag in the last ${Math.round(w.span() / 1000)} s.`
        + (mixState === 'ok' ? '' : '\n\nRendering lag = the mux PC\'s GPU cannot finish each frame in time: lower its frame rate, or trim its scene (capture inputs, filters, browser sources).');

    // NDI OUT
    const o = m.ndiOut;
    const ndiFps = w.rate('ndiFrames');
    const oLag = w.share('outSkipped', 'outTotal');
    const cpu = round1(s.cpuUsage || 0);
    let ndiState = !o ? 'bad' : !o.outputActive ? 'bad' : lagState(oLag);
    if (o && o.outputActive && ndiFps != null && fps && ndiFps < fps * 0.9) ndiState = worst(ndiState, 'warn');
    if (cpu > 85) ndiState = worst(ndiState, 'warn');
    const ndiDrift = !!(o && o.outputActive && ndiFps != null && fps && w.span() >= 4000 && Math.abs(ndiFps - fps) > fps * 0.05);
    const ndiVal = !o ? 'NO OUTPUT' : !o.outputActive ? 'STOPPED' : `${ndiFps == null ? '-' : round1(ndiFps)} fps`;
    const ndiDetail = !o ? `${machine} has no NDI output` : `${m.ndiOutName}${stream ? ` ("${stream}")` : ''}: ${o.outputActive ? 'sending' : 'stopped'}, ${ndiFps == null ? '-' : round1(ndiFps)} fps; ${oLag == null ? '-' : `${oLag}%`} of frames skipped for output (encoding) lag; OBS CPU ${cpu}%.`
        + (ndiState === 'ok' ? '' : '\n\nOutput lag = the mux PC cannot encode NDI fast enough (CPU), or its output was stopped.');

    // LINK
    const avg = m.rtt.length ? Math.round(m.rtt.reduce((a, b) => a + b, 0) / m.rtt.length) : 0;
    const max = m.rtt.length ? Math.max(...m.rtt) : 0;
    const linkState = m.timeouts ? 'bad' : max > 250 ? 'warn' : avg > 60 ? 'warn' : 'ok';
    const linkDetail = `${machine}'s control port answers in ${avg} ms on average (worst ${max} ms) from the Dreamscape server.${m.timeouts ? ` ${m.timeouts} missed: ${m.error}` : ''}`
        + (linkState === 'ok' ? '' : avg >= 100
            ? `\n\nOn the same LAN an answer should take a few ms. A steady ${avg} ms means a full queue: a link between ${machine} and Ruiko is saturated. NDI needs about 100 Mb/s at 1080p30 and 150 Mb/s at 1080p60, so a 100 Mb/s port, cable, switch, powerline or Wi-Fi hop fills up, delays everything and drops NDI packets (stutter on Ruiko). Check ${machine}'s link speed (Task Manager > Performance > Ethernet) is 1 Gbps.`
            : '\n\nSlow answers on the LAN usually mean a busy mux PC, a bad cable / switch port, or Wi-Fi.');

    // CLOCK: the mux's own frame clock; LOCK: whether it can run in lockstep with the satellite
    const clockState = !fps ? 'bad' : mixClock ? 'warn' : 'ok';
    const clockDetail = `${machine} runs ${v.outputWidth || '?'}x${v.outputHeight || '?'} at ${fps ? fmtFps(fps) : '?'} fps (base ${v.baseWidth || '?'}x${v.baseHeight || '?'})${mixClock ? `, but only ${active} fps come out: its clock is not held, so frames reach the satellite unevenly.` : '.'}`;
    const ratio = lockRatio(fps, satFps);
    const lockState = !satFps ? 'wait' : ratio ? 'ok' : 'bad';
    const lockVal = !satFps ? '...' : ratio ? `${ratio} LOCKED` : 'NO LOCK';
    const lockDetail = !satFps ? 'Waiting for the satellite\'s frame rate'
        : ratio ? `${fmtFps(fps)} fps into the satellite's ${fmtFps(satFps)} fps: ${ratio}, every cabinet frame lands on a satellite frame (lockstep).`
            : `${fmtFps(fps)} fps into the satellite's ${fmtFps(satFps)} fps cannot lock: one is not a whole multiple of the other (e.g. 59.94 vs 60, 25 vs 30), so frames are repeated or dropped unevenly and the picture judders and drifts. Run both at matching rates (30/60, or 29.97/59.94).`;

    return {
        source, sourceDetail, program: m.program, fps: round1(fps),
        captures: caps.map((c) => ({ name: c.name, kind: c.kind, width: c.width, height: c.height, fps: c.fps || null, buffering: c.buffering || "", delayMs: c.delayMs || 0, syncMs: c.syncMs || 0 })),
        stages: [
            stage('capture', 'CAPTURE', capState, capVal, capDetail, odd.length > 0),
            stage('clock', 'CLOCK', clockState, `${v.outputHeight || '?'}p${fmtFps(fps)}`, clockDetail, clockState !== 'ok'),
            stage('mixer', 'MIXER', mixState, `${active} fps · ${ms} ms`, mixDetail, mixClock),
            stage('ndiout', 'NDI OUT', ndiState, ndiVal, ndiDetail, ndiDrift),
            stage('link', 'LINK', linkState, `${avg} ms`, linkDetail),
            stage('lock', 'LOCK', lockState, lockVal, lockDetail, lockState === 'bad')
        ],
        note: ''
    };
}

const ruikoWin = new Window();

function outputRow(st, stats, cabinet, feed) {
    const live = !!(st.stream && st.stream.active);
    const v = st.video;
    if (!v) return { source: 'RUIKO', stages: [], note: '' };
    ruikoWin.add({
        renderSkipped: stats.renderSkippedFrames || 0, renderTotal: stats.renderTotalFrames || 0,
        outSkipped: stats.outputSkippedFrames || 0, outTotal: stats.outputTotalFrames || 0,
        netSkipped: live ? st.stream.skipped : 0, netTotal: live ? st.stream.frames : 0
    });
    const w = ruikoWin;
    const budget = v.fps ? 1000 / v.fps : 0;
    const out = [];


    // NDI RX
    const onAir = cabinet ? feed : null;
    const ndi = onAir && onAir.find((f) => f.ndiName);
    if (!cabinet) out.push(stage('rx', 'NDI RX', 'off', '-', 'Pick a cabinet'));
    else if (!onAir) out.push(stage('rx', 'NDI RX', 'wait', '...', 'Checking the cabinet\'s NDI source on Ruiko'));
    else if (!ndi) out.push(stage('rx', 'NDI RX', 'off', 'NO NDI', `"${cabinet.scene}" has no NDI source`));
    else {
        const ok = ndi.width > 0 && ndi.height > 0;
        if (!ok && ndi.active === false) out.push(stage('rx', 'NDI RX', 'off', 'STANDBY', `Ruiko's "${ndi.name}" (NDI "${ndi.ndiName}") is not on program or preview, so it may not be receiving. Pick the cabinet to put it on program.`));
        else out.push(stage('rx', 'NDI RX', ok ? 'ok' : 'bad', ok ? `${ndi.width}x${ndi.height}` : 'NO PICTURE',
            `Ruiko's "${ndi.name}" receives NDI "${ndi.ndiName}": ${ok ? `${ndi.width}x${ndi.height}` : 'nothing (0x0)'}${ndi.active === false ? '; the source is not on program or preview' : ''}.`
            + (ok ? '' : '\n\nNothing arriving: the mux PC is not sending (see INPUT), or NDI cannot get through (network, firewall, NDI discovery / name changed).')));
    }

    // CLOCK: the satellite's frame clock
    const satClock = !!(v.fps && v.activeFps < v.fps * 0.97);
    out.push(stage('clock', 'CLOCK', satClock ? 'warn' : 'ok', `${v.output.split('x')[1]}p${fmtFps(v.fps)}`,
        `Base ${v.base}, output ${v.output} at ${fmtFps(v.fps)} fps; profile ${st.profile || '-'}${satClock ? `. Only ${v.activeFps} fps come out: Ruiko is not holding its clock.` : ''}`, satClock));

    // RENDER
    const rLag = w.share('renderSkipped', 'renderTotal');
    const ms = round1(stats.averageFrameRenderTime || 0);
    let rState = lagState(rLag);
    if (budget && ms > budget * 0.9) rState = worst(rState, 'warn');
    if (v.fps && v.activeFps < v.fps * 0.9) rState = worst(rState, 'bad');
    out.push(stage('render', 'RENDER', rState, `${v.activeFps} fps · ${ms} ms`,
        `Ruiko renders ${v.activeFps} of ${v.fps} fps; average frame ${ms} ms of ${round1(budget)} ms; ${rLag == null ? '-' : `${rLag}%`} skipped for rendering lag (last ${Math.round(w.span() / 1000)} s). CPU ${v.cpu}%.`));

    // ENCODER
    const eLag = w.share('outSkipped', 'outTotal');
    const eState = live ? lagState(eLag) : 'off';
    out.push(stage('encoder', 'ENCODER', eState, live ? `${eLag == null ? '-' : eLag}% lag` : 'IDLE',
        live ? `${eLag == null ? '-' : `${eLag}%`} of frames skipped for encoding lag in the last ${Math.round(w.span() / 1000)} s (total ${stats.outputSkippedFrames || 0} / ${stats.outputTotalFrames || 0}).`
            + (eState === 'ok' ? '' : '\n\nEncoding lag = the encoder (NVENC on Ruiko) cannot keep up: a slower preset, lower resolution / fps, or another app using the GPU encoder.')
            : 'Not streaming'));

    // NETWORK
    if (!live) out.push(stage('network', 'NETWORK', 'off', 'IDLE', 'Not streaming'));
    else {
        const nDrop = w.share('netSkipped', 'netTotal');
        let nState = st.stream.reconnecting ? 'bad' : lagState(nDrop);
        if (st.stream.congestion > 60) nState = worst(nState, 'bad');
        else if (st.stream.congestion > 25) nState = worst(nState, 'warn');
        out.push(stage('network', 'NETWORK', nState, st.stream.reconnecting ? 'RECONNECTING' : `${st.stream.kbps.toLocaleString('en-US')} kb/s`,
            `${st.stream.kbps.toLocaleString('en-US')} kb/s to YouTube; ${nDrop == null ? '-' : `${nDrop}%`} of frames dropped by the network (last ${Math.round(w.span() / 1000)} s; ${st.stream.skipped} / ${st.stream.frames} total); congestion ${st.stream.congestion}%.`
            + (nState === 'ok' ? '' : '\n\nNetwork drops = Ruiko\'s upload cannot carry the bitrate: lower the bitrate, check the uplink, or other uploads on the line.')));
    }

    // YOUTUBE
    const h = st.youtube && st.youtube.health;
    if (!live) out.push(stage('youtube', 'YOUTUBE', 'off', 'IDLE', 'Not streaming'));
    else if (!h) out.push(stage('youtube', 'YOUTUBE', 'off', '-', 'Sign in (Settings > Account) so QuickCast makes the broadcast and can read YouTube\'s ingest health'));
    else {
        const map = { good: 'ok', ok: 'ok', bad: 'warn', noData: 'bad' };
        const ys = h.error ? 'wait' : map[h.status] || 'wait';
        const issues = (h.issues || []).filter((i) => i.severity !== 'info');
        out.push(stage('youtube', 'YOUTUBE', issues.some((i) => i.severity === 'error') ? 'bad' : issues.length ? worst(ys, 'warn') : ys,
            (h.status || '...').toUpperCase(),
            `YouTube ingest health: ${h.status || 'not read yet'}${h.error ? ` (${h.error})` : ''}${(h.issues || []).length ? `\n${h.issues.map((i) => `${i.severity}: ${i.description || i.reason || i.type}`).join('\n')}` : ''}`));
    }
    return { source: 'RUIKO', stages: out, note: '' };
}

/** One line: the first stage, in signal order (cabinet first), that is bad, else warn. */
function verdict(input, output) {
    const chain = [...input.stages.map((s) => ({ ...s, row: 'cabinet' })), ...output.stages.map((s) => ({ ...s, row: 'satellite' }))];
    const pick = chain.find((s) => s.state === 'bad') || chain.find((s) => s.state === 'warn');
    const where = {
        capture: 'Capture on the cabinet', mixer: 'The cabinet\'s mixer (rendering)', ndiout: 'The cabinet\'s NDI encoder', link: 'Network to the cabinet',
        clock: 'Frame clock', lock: 'Cabinet / satellite frame lock',
        rx: 'NDI transport to Ruiko', render: 'Ruiko\'s rendering', encoder: 'Ruiko\'s hardware encoder', network: 'Network from Ruiko to YouTube', youtube: 'YouTube ingest', format: 'Format'
    };
    if (!pick) {
        const waiting = chain.some((s) => s.state === 'wait');
        return { state: waiting ? 'wait' : chain.length ? 'ok' : 'off', text: waiting ? 'Measuring...' : chain.length ? 'All stages OK' : input.note || '' };
    }
    return { state: pick.state, stage: pick.id, text: `${where[pick.id] || pick.label}: ${pick.state === 'bad' ? 'failing' : 'struggling'} (${pick.value})` };
}

// ------------------------------------------------------------------ for the box OSD (avOsd.js)

/** The NDI machine (mux PC) that feeds a cabinet's scene on Ruiko, or ''. */
async function machineForCabinet(cabinetId) {
    const cabinet = deps.readConfig().cabinets.find((c) => c.id === cabinetId);
    if (!cabinet) return '';
    await deps.ruiko.connect();
    const inputs = await scanFeed(cabinet.scene);
    const ndi = inputs.find((f) => f.ndiName);
    return ndi ? splitNdi(ndi.ndiName).machine : '';
}

/** An obs-websocket link to a mux PC (kept open while asked), with its target. */
async function muxLink(machine) {
    const m = askMux(machine);
    if (m.resolving) await m.resolving;
    if (!m.target) throw Object.assign(new Error(m.error || `${machine} has no address`), { code: 'QUICKCAST_MUX' });
    if (!m.link) m.link = deps.makeLink(() => m.target, machine);
    await m.link.connect();
    return { link: m.link, target: m.target };
}

const lastDiag = new Map(); // cabinetId -> the last diagnose() result
function lastFor(cabinetId) { return lastDiag.get(cabinetId || '') || null; }

/** From status(), with its Ruiko read and GetStats: { input, output, verdict } for the cabinet. */
function diagnose(st, stats, cabinetId) {
    if (!deps) return null;
    const cfg = deps.readConfig();
    const cabinet = cfg.cabinets.find((c) => c.id === cabinetId) || null;
    const feed = cabinet && deps.ruiko.online ? feedFor(cabinet.scene) : null;
    let input;
    try { input = inputRow(cabinet, feed, st.video ? st.video.fps : 0); } catch (e) { input = { source: '', stages: [], note: e.message }; }
    const output = outputRow(st, stats || {}, cabinet, feed);
    const res = { columns: COLUMNS, input, output, verdict: verdict(input, output) };
    lastDiag.set(cabinetId || '', res);
    return res;
}

module.exports = { onUnitRestart, init, diagnose, splitNdi, lockRatio, COLUMNS, machineForCabinet, muxLink, lastFor, _Window: Window, _muxes: muxes, _feeds: feeds };
