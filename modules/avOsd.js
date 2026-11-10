/**
 * AmusementVISION box OSD (Yozora #734): every box in the broadcast chain (a cabinet's mixer / muxer PC,
 * the satellite encoder) is run like a headless hardware mixer. Its menus are drawn IN ITS OWN VIDEO
 * OUTPUT, the way a hardware switcher draws its OSD on its program out, and driven with a remote
 * (D-pad, OK, MENU, DIAG, INFO, EXIT) from QuickCast. Nothing to install on the boxes: they only need
 * OBS with obs-websocket.
 *
 * On each box's OBS:
 *   scene "AV OSD"            holds browser source "AV OSD Overlay", the box's OSD page served by
 *                             Dreamscape (/av-osd/<box>?k=<token>, avOsdHttp.js), transparent
 *   item "AV OSD"             that scene nested on top of the box's program scene, enabled only while the
 *                             menu or the INFO strip is up (a hidden browser source does not render)
 *
 * The menu state lives here; the page only draws what it is sent (Server-Sent Events). Settings are
 * applied over the box's obs-websocket:
 *   INPUT ASSIGNMENT   which hardware port / device / NDI feed each logical input takes
 *   TIMING             per input video delay (an "AV Delay" Video Delay (Async) filter) and audio sync
 *   AUDIO              per input level and mute
 *   SCENE              the box's program scene
 *   VIDEO CLOCK        the box's frame rate (against the satellite's: lockstep)
 *   SYSTEM / DIAG      versions, load, and the QuickCast pipeline diagnostics for that box
 *
 * Box ids: "sat" (OBS on Ruiko) and "mux-<machine>" (a cabinet mux PC by NDI machine name).
 * Tokens (data dir osd.json, 0600) only let a page read its own box's OSD state, nothing else.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OVERLAY_SCENE = 'AV OSD';
const OVERLAY_INPUT = 'AV OSD Overlay';
const DELAY_FILTER = 'AV Delay';
const PAGE_ROWS = 12;
const FPS_CHOICES = [[24, 1], [25, 1], [30000, 1001], [30, 1], [50, 1], [60000, 1001], [60, 1]];

/** inputKind -> the property that picks its hardware / feed, and a short port type for the OSD */
const PORTS = {
    dshow_input: { prop: 'video_device_id', type: 'UVC/HDMI' },
    av_capture_input: { prop: 'device', type: 'UVC/HDMI' },
    av_capture_input_v2: { prop: 'device', type: 'UVC/HDMI' },
    v4l2_input: { prop: 'device_id', type: 'UVC/HDMI' },
    'decklink-input': { prop: 'device_hash', type: 'SDI/HDMI' },
    ndi_source: { prop: 'ndi_source_name', type: 'NDI' },
    monitor_capture: { prop: 'monitor_id', type: 'DISPLAY' },
    wasapi_input_capture: { prop: 'device_id', type: 'AUDIO IN' },
    wasapi_output_capture: { prop: 'device_id', type: 'AUDIO OUT' }
};
const VIDEO_KINDS = new Set(['dshow_input', 'av_capture_input', 'av_capture_input_v2', 'v4l2_input', 'decklink-input', 'ndi_source', 'monitor_capture', 'window_capture', 'game_capture', 'ffmpeg_source']);

let deps = null; // { ruiko: ObsLink, diag, readConfig, dataDir }

function init(d) { deps = d; }

// ------------------------------------------------------------------ tokens

function tokenFile() { return path.join(deps.dataDir, 'osd.json'); }

function tokens() {
    let t = {};
    try { t = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')) || {}; } catch (_) { t = {}; }
    return t;
}

function tokenFor(boxId) {
    const t = tokens();
    if (!t[boxId]) {
        t[boxId] = crypto.randomBytes(18).toString('base64url');
        fs.mkdirSync(deps.dataDir, { recursive: true });
        fs.writeFileSync(tokenFile(), JSON.stringify(t, null, 2), { mode: 0o600 });
    }
    return t[boxId];
}

function checkToken(boxId, k) {
    const want = tokens()[boxId];
    if (!want || typeof k !== 'string' || k.length !== want.length) return false;
    return crypto.timingSafeEqual(Buffer.from(k), Buffer.from(want));
}

// ------------------------------------------------------------------ boxes

const boxes = new Map(); // id -> box

const fail = (message, code) => Object.assign(new Error(message), { code: code || 'AVOSD_ERROR' });
const validId = (id) => /^(sat|mux-[A-Za-z0-9 ._-]{1,40})$/.test(id);

function box(id) {
    if (!validId(id)) throw fail('Unknown box', 'AVOSD_BOX');
    let b = boxes.get(id);
    if (!b) {
        b = { id, kind: id === 'sat' ? 'satellite' : 'cabinet', machine: id === 'sat' ? '' : id.slice(4), open: false, info: false, stack: [], toast: '', toastAt: 0, rev: 0, subs: new Set(), view: null, pending: new Map(), busy: false };
        boxes.set(id, b);
    }
    return b;
}

async function linkOf(b) {
    if (b.kind === 'satellite') {
        await deps.ruiko.connect();
        const o = deps.readConfig().obs;
        return { link: deps.ruiko, target: { host: o.host, port: Number(o.port) || 4455 } };
    }
    return deps.diag.muxLink(b.machine);
}

/** The box a QuickCast remote is pointed at: the satellite, or the mux PC feeding a cabinet. */
async function resolveBox(target, cabinetId) {
    if (target === 'sat') return box('sat');
    const machine = await deps.diag.machineForCabinet(cabinetId);
    if (!machine) throw fail('This cabinet\'s scene on the satellite has no NDI feed, so there is no mux box to control', 'AVOSD_NOMUX');
    return box(`mux-${machine}`);
}

function boxName(b) { return b.kind === 'satellite' ? 'SATELLITE ENCODER' : `AV-MUX ${b.machine}`; }

// ------------------------------------------------------------------ the overlay on the box's OBS

function overlayUrl(b) {
    const base = String((deps.readConfig().osd || {}).baseUrl || 'http://192.168.100.250:9220').replace(/\/+$/, '');
    return `${base}/av-osd/${encodeURIComponent(b.id)}?k=${encodeURIComponent(tokenFor(b.id))}`;
}

async function ensureOverlay(b, link) {
    const url = overlayUrl(b);
    const video = await link.request('GetVideoSettings');
    const scenes = (await link.request('GetSceneList')).scenes || [];
    if (!scenes.some((s) => s.sceneName === OVERLAY_SCENE)) await link.request('CreateScene', { sceneName: OVERLAY_SCENE });
    const settings = {
        url, width: video.baseWidth || 1920, height: video.baseHeight || 1080,
        css: 'html, body { background: transparent !important; margin: 0; overflow: hidden; }',
        shutdown: false, restart_when_active: false, reroute_audio: false, webpage_control_level: 0
    };
    let have = null;
    try { have = await link.request('GetInputSettings', { inputName: OVERLAY_INPUT }); } catch (_) { have = null; }
    if (!have) {
        await link.request('CreateInput', { sceneName: OVERLAY_SCENE, inputName: OVERLAY_INPUT, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true });
    } else {
        const cur = have.inputSettings || {};
        if (cur.url !== url || cur.width !== settings.width || cur.height !== settings.height) await link.request('SetInputSettings', { inputName: OVERLAY_INPUT, inputSettings: settings, overlay: true });
    }
}

/** Show or hide the OSD layer on top of the box's program scene. */
async function placeOverlay(b) {
    const want = b.open || b.info;
    const { link } = await linkOf(b);
    if (want) await ensureOverlay(b, link);
    const program = (await link.request('GetCurrentProgramScene')).currentProgramSceneName;
    if (!program || program === OVERLAY_SCENE) return;
    const items = (await link.request('GetSceneItemList', { sceneName: program })).sceneItems || [];
    const it = items.find((i) => i.sourceName === OVERLAY_SCENE);
    if (want) {
        let id = it && it.sceneItemId;
        if (!id) id = (await link.request('CreateSceneItem', { sceneName: program, sourceName: OVERLAY_SCENE, sceneItemEnabled: true })).sceneItemId;
        else if (!it.sceneItemEnabled) await link.request('SetSceneItemEnabled', { sceneName: program, sceneItemId: id, sceneItemEnabled: true });
        const top = items.length - (it ? 1 : 0);
        if (!it || it.sceneItemIndex !== top) await link.request('SetSceneItemIndex', { sceneName: program, sceneItemId: id, sceneItemIndex: top });
        b.overlayScene = program;
    } else if (it && it.sceneItemEnabled) {
        await link.request('SetSceneItemEnabled', { sceneName: program, sceneItemId: it.sceneItemId, sceneItemEnabled: false });
    }
    // a scene left with the OSD on (the program changed while it was up)
    if (b.overlayScene && b.overlayScene !== program) {
        try {
            const old = (await link.request('GetSceneItemList', { sceneName: b.overlayScene })).sceneItems || [];
            const o = old.find((i) => i.sourceName === OVERLAY_SCENE && i.sceneItemEnabled);
            if (o) await link.request('SetSceneItemEnabled', { sceneName: b.overlayScene, sceneItemId: o.sceneItemId, sceneItemEnabled: false });
        } catch (_) { /* scene gone */ }
        if (want) b.overlayScene = program;
    }
    if (!want) b.overlayScene = '';
}

// ------------------------------------------------------------------ pages

const round1 = (n) => Math.round(n * 10) / 10;
const fpsText = (num, den) => { const f = den ? num / den : 0; return Math.abs(f - Math.round(f)) < 0.005 ? String(Math.round(f)) : f.toFixed(2); };

async function portInputs(link) {
    const list = (await link.request('GetInputList')).inputs || [];
    return list.filter((i) => PORTS[i.inputKind] && i.inputName !== OVERLAY_INPUT);
}

async function videoInputs(link) {
    const list = (await link.request('GetInputList')).inputs || [];
    return list.filter((i) => VIDEO_KINDS.has(i.inputKind) && i.inputName !== OVERLAY_INPUT);
}

async function portOptions(link, inp) {
    const prop = PORTS[inp.inputKind].prop;
    try {
        const r = await link.request('GetInputPropertiesListPropertyItems', { inputName: inp.inputName, propertyName: prop });
        return (r.propertyItems || []).filter((o) => o.itemEnabled !== false).map((o) => ({ value: o.itemValue, text: String(o.itemName || o.itemValue || '-') }));
    } catch (_) { return []; }
}

/** Each page: async build(b, link, frame) -> { title, rows: [{ id, label, value, kind, hint, state }] }
 *  kinds: nav (OK opens), pick (left/right choose, OK applies), adjust (left/right changes now),
 *         toggle (OK flips), action (OK runs), info (read only). */
const PAGES = {
    async main(b) {
        return {
            title: 'MAIN MENU',
            rows: [
                { id: 'inputs', label: 'INPUT ASSIGNMENT', kind: 'nav', value: '' },
                { id: 'timing', label: 'TIMING / SYNC', kind: 'nav', value: '' },
                { id: 'audio', label: 'AUDIO LEVELS', kind: 'nav', value: '' },
                { id: 'scene', label: 'SCENE / LAYOUT', kind: 'nav', value: '' },
                { id: 'clock', label: 'VIDEO CLOCK', kind: 'nav', value: '' },
                { id: 'diag', label: 'DIAGNOSTICS', kind: 'nav', value: '' },
                { id: 'system', label: 'SYSTEM INFORMATION', kind: 'nav', value: '' }
            ],
            hint: b.kind === 'satellite' ? 'Satellite encoder settings' : 'Cabinet mixer settings'
        };
    },

    async inputs(b, link) {
        const ins = await portInputs(link);
        const rows = [];
        for (let n = 0; n < ins.length; n++) {
            const inp = ins[n];
            const prop = PORTS[inp.inputKind].prop;
            const set = (await link.request('GetInputSettings', { inputName: inp.inputName }).catch(() => ({ inputSettings: {} }))).inputSettings || {};
            const opts = await portOptions(link, inp);
            const cur = set[prop];
            const pend = b.pending.get(`port:${inp.inputName}`);
            const show = pend != null ? pend : cur;
            const o = opts.find((x) => x.value === show);
            rows.push({
                id: `port:${inp.inputName}`, label: `IN${String(n + 1).padStart(2, '0')} ${inp.inputName}`, kind: 'pick',
                value: o ? o.text : show ? String(show) : '(none)', type: PORTS[inp.inputKind].type,
                changed: pend != null && pend !== cur, options: opts.length,
                hint: opts.length ? `${PORTS[inp.inputKind].type} port — ◄► choose, OK assign` : 'No ports listed by this input'
            });
        }
        return { title: 'INPUT ASSIGNMENT', rows: rows.length ? rows : [{ id: 'none', label: 'No assignable inputs', kind: 'info', value: '' }], hint: 'Each logical input takes one hardware port / feed' };
    },

    async timing(b, link) {
        const ins = await videoInputs(link);
        const rows = [
            { id: 'align', label: 'AUTO ALIGN CAMERA \u2192 GAME', kind: 'nav', value: b.align && b.align.result ? b.align.result.short : '' },
            { id: 'fpsm', label: 'MEASURE INPUT FRAME RATES', kind: 'nav', value: '' }
        ];
        for (const inp of ins) {
            const f = await delayOf(link, inp.inputName);
            let sync = null;
            try { sync = (await link.request('GetInputAudioSyncOffset', { inputName: inp.inputName })).inputAudioSyncOffset; } catch (_) { sync = null; }
            rows.push({ id: `delay:${inp.inputName}`, label: `${inp.inputName} VIDEO`, kind: 'adjust', value: `${f} ms`, hint: 'Video delay — ◄► 10 ms' });
            if (sync != null) rows.push({ id: `sync:${inp.inputName}`, label: `${inp.inputName} AUDIO`, kind: 'adjust', value: `${sync > 0 ? '+' : ''}${sync} ms`, hint: 'Audio sync offset — ◄► 10 ms' });
        }
        return { title: 'TIMING / SYNC', rows: rows.length > 2 ? rows : [{ id: 'none', label: 'No video inputs', kind: 'info', value: '' }], hint: 'Delay the early input so camera and game line up' };
    },

    async align(b, link) {
        const ins = (await videoInputs(link)).map((i) => i.inputName);
        const sel = alignSel(b, ins, await videoInputs(link));
        const a = b.align || {};
        const res = a.result;
        return {
            title: 'AUTO ALIGN',
            rows: [
                { id: 'al:cam', label: 'CAMERA', kind: 'pick', value: sel.cam || '-', hint: 'The camera that films the cabinet screen \u2014 \u25c4\u25ba' },
                { id: 'al:ref', label: 'REFERENCE (GAME)', kind: 'pick', value: sel.ref || '-', hint: 'The game capture the camera must match \u2014 \u25c4\u25ba' },
                { id: 'al:go', label: a.running ? 'MEASURING...' : 'START', kind: 'action', value: a.running ? `${Math.max(0, Math.round((a.until - Date.now()) / 1000))} s` : '', blink: !!a.running, hint: 'Play or flash the screen while it measures (8 s). Not while this box is on air.' },
                { id: 'al:res', label: 'RESULT', kind: 'info', value: res ? res.text : a.error || '-', state: res ? (res.ok ? 'ok' : 'warn') : a.error ? 'bad' : '' },
                { id: 'al:conf', label: 'MATCH', kind: 'info', value: res && res.score != null ? `${Math.round(res.score * 100)} %` : '-', state: res && res.score != null ? (res.score >= 0.5 ? 'ok' : res.score >= 0.3 ? 'warn' : 'bad') : '' }
            ],
            hint: 'Measures camera vs game frames on the box\'s own clock, then sets the video delay'
        };
    },

    async fpsm(b, link) {
        const v = await link.request('GetVideoSettings');
        const fps = v.fpsDenominator ? v.fpsNumerator / v.fpsDenominator : 0;
        const m = b.fpsm || {};
        const rows = [{ id: 'fm:go', label: m.running ? 'MEASURING...' : 'MEASURE NOW', kind: 'action', value: m.running ? '' : m.at ? new Date(m.at).toTimeString().slice(0, 8) : '', blink: !!m.running, hint: 'Samples every input on every frame for 2 s (needs motion in the picture). Not on air.' }];
        for (const r of m.results || []) {
            const lockOk = r.fps && fps ? deps.diag.lockRatio(r.fps, fps) : null;
            rows.push({ id: `fm:${r.name}`, label: r.name, kind: 'info', value: r.fps == null ? 'NO MOTION' : `${r.fps} fps${r.target ? ` / ${r.target} set` : ''}`, state: r.fps == null ? 'warn' : r.target && Math.abs(r.fps - r.target) > r.target * 0.1 ? 'bad' : lockOk || r.fps >= fps * 0.95 ? 'ok' : 'warn', blink: !!(r.target && r.fps && Math.abs(r.fps - r.target) > r.target * 0.1) });
        }
        if (m.error) rows.push({ id: 'fm:err', label: m.error, kind: 'info', value: '', state: 'bad' });
        return { title: 'INPUT FRAME RATES', rows, hint: `Box clock ${fpsText(v.fpsNumerator, v.fpsDenominator)} fps: an input can show at most that` };
    },

    async audio(b, link) {
        const list = (await link.request('GetInputList')).inputs || [];
        const rows = [];
        for (const inp of list) {
            if (inp.inputName === OVERLAY_INPUT) continue;
            let vol;
            let mute;
            try {
                vol = await link.request('GetInputVolume', { inputName: inp.inputName });
                mute = await link.request('GetInputMute', { inputName: inp.inputName });
            } catch (_) { continue; }
            const db = vol.inputVolumeDb;
            rows.push({ id: `vol:${inp.inputName}`, label: inp.inputName, kind: 'adjust', value: mute.inputMuted ? 'MUTE' : `${db <= -100 ? '-inf' : round1(db).toFixed(1)} dB`, state: mute.inputMuted ? 'warn' : '', hint: '◄► 1 dB, OK mute' });
        }
        return { title: 'AUDIO LEVELS', rows: rows.length ? rows : [{ id: 'none', label: 'No audio inputs', kind: 'info', value: '' }] };
    },

    async scene(b, link) {
        const r = await link.request('GetSceneList');
        const rows = (r.scenes || []).filter((s) => s.sceneName !== OVERLAY_SCENE).reverse()
            .map((s) => ({ id: `scene:${s.sceneName}`, label: s.sceneName, kind: 'action', value: s.sceneName === r.currentProgramSceneName ? '● PGM' : '', state: s.sceneName === r.currentProgramSceneName ? 'on' : '', hint: 'OK puts the scene on program' }));
        return { title: 'SCENE / LAYOUT', rows };
    },

    async clock(b, link) {
        const v = await link.request('GetVideoSettings');
        const st = await link.request('GetStats');
        const pend = b.pending.get('fps');
        const cur = [v.fpsNumerator, v.fpsDenominator];
        const show = pend || cur;
        let sat = null;
        if (b.kind === 'cabinet') {
            try { const sv = await deps.ruiko.request('GetVideoSettings', {}, 3000); sat = sv.fpsDenominator ? sv.fpsNumerator / sv.fpsDenominator : null; } catch (_) { sat = null; }
        }
        const lock = sat ? deps.diag.lockRatio(show[0] / show[1], sat) : null;
        const rows = [
            { id: 'fps', label: 'FRAME RATE', kind: 'pick', value: `${fpsText(show[0], show[1])} fps`, changed: !!pend && (pend[0] !== cur[0] || pend[1] !== cur[1]), hint: '◄► choose, OK apply' },
            { id: 'res', label: 'RESOLUTION', kind: 'info', value: `${v.outputWidth}x${v.outputHeight}` },
            { id: 'active', label: 'RUNNING', kind: 'info', value: `${round1(st.activeFps || 0)} fps`, state: st.activeFps < (cur[0] / cur[1]) * 0.97 ? 'bad' : '' }
        ];
        if (b.kind === 'cabinet') rows.push({ id: 'lock', label: 'LOCK TO SATELLITE', kind: 'info', value: sat == null ? '-' : lock ? `${lock} LOCKED` : `NO LOCK (${fpsText(sat * 1000, 1000)})`, state: sat != null && !lock ? 'bad' : '', blink: sat != null && !lock });
        return { title: 'VIDEO CLOCK', rows };
    },

    async diag(b) {
        const rows = [];
        const all = deps.readConfig().cabinets.map((c) => c.id);
        let pick = null;
        for (const cab of all) {
            const d = deps.diag.lastFor(cab);
            if (!d) continue;
            if (b.kind === 'satellite') { pick = d.output; break; }
            if (d.input && d.input.source === b.machine) { pick = d.input; break; }
        }
        for (const s of (pick && pick.stages) || []) rows.push({ id: `d:${s.id}`, label: s.label, kind: 'info', value: s.value, state: s.state === 'ok' ? 'ok' : s.state === 'bad' ? 'bad' : s.state === 'warn' ? 'warn' : '', blink: s.blink, detail: String(s.detail || '').split('\n')[0] });
        return { title: 'DIAGNOSTICS', rows: rows.length ? rows : [{ id: 'none', label: 'No readings yet (open QuickCast with this box\'s cabinet)', kind: 'info', value: '' }] };
    },

    async system(b, link, frame, target) {
        const ver = await link.request('GetVersion');
        const st = await link.request('GetStats');
        const v = await link.request('GetVideoSettings');
        return {
            title: 'SYSTEM INFORMATION',
            rows: [
                { id: 's:name', label: 'UNIT', kind: 'info', value: boxName(b) },
                { id: 's:addr', label: 'ADDRESS', kind: 'info', value: `${target.host}:${target.port}` },
                { id: 's:obs', label: 'ENGINE', kind: 'info', value: `OBS ${ver.obsVersion} / WS ${ver.obsWebSocketVersion}` },
                { id: 's:os', label: 'PLATFORM', kind: 'info', value: String(ver.platformDescription || ver.platform || '-').slice(0, 34) },
                { id: 's:fmt', label: 'FORMAT', kind: 'info', value: `${v.outputWidth}x${v.outputHeight} ${fpsText(v.fpsNumerator, v.fpsDenominator)}` },
                { id: 's:cpu', label: 'CPU', kind: 'info', value: `${round1(st.cpuUsage || 0)} %` },
                { id: 's:mem', label: 'MEMORY', kind: 'info', value: `${Math.round(st.memoryUsage || 0)} MB` },
                { id: 's:disk', label: 'DISK FREE', kind: 'info', value: `${round1((st.availableDiskSpace || 0) / 1024)} GB` },
                { id: 's:render', label: 'FRAME TIME', kind: 'info', value: `${round1(st.averageFrameRenderTime || 0)} ms` }
            ]
        };
    }
};

async function delayOf(link, inputName) {
    try {
        const f = await link.request('GetSourceFilter', { sourceName: inputName, filterName: DELAY_FILTER });
        return f.filterEnabled ? Number((f.filterSettings || {}).delay_ms) || 0 : 0;
    } catch (_) { return 0; }
}

async function setDelay(link, inputName, ms) {
    ms = Math.max(0, Math.min(5000, Math.round(ms)));
    let has = true;
    try { await link.request('GetSourceFilter', { sourceName: inputName, filterName: DELAY_FILTER }); } catch (_) { has = false; }
    if (!has) await link.request('CreateSourceFilter', { sourceName: inputName, filterName: DELAY_FILTER, filterKind: 'async_delay_filter', filterSettings: { delay_ms: ms } });
    else {
        await link.request('SetSourceFilterSettings', { sourceName: inputName, filterName: DELAY_FILTER, filterSettings: { delay_ms: ms }, overlay: true });
        await link.request('SetSourceFilterEnabled', { sourceName: inputName, filterName: DELAY_FILTER, filterEnabled: true });
    }
    return ms;
}

// ------------------------------------------------------------------ auto align (camera vs game)

function alignSel(b, names, inputs) {
    const s = b.alignSel || (b.alignSel = {});
    if (!names.includes(s.cam)) s.cam = names.find((n) => /cam|overhead|side|face|hand/i.test(n)) || names.find((n) => (inputs.find((i) => i.inputName === n) || {}).inputKind === 'dshow_input') || names[0] || '';
    if (!names.includes(s.ref) || s.ref === s.cam) s.ref = names.find((n) => n !== s.cam && /game|alls|capture|display/i.test(n)) || names.find((n) => n !== s.cam) || '';
    return s;
}

async function lumaOf(dataUrl) {
    const sharp = require('sharp');
    const b64 = String(dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
    const st = await sharp(Buffer.from(b64, 'base64')).greyscale().stats();
    return st.channels[0].mean;
}

/** Best lag (in samples) of b against a: a[i] ~ b[i - lag]; positive = b is behind... see measureAlign */
function bestLag(a, b, maxLag) {
    const da = a.slice(1).map((x, i) => x - a[i]);
    const db = b.slice(1).map((x, i) => x - b[i]);
    const mean = (v) => v.reduce((s, x) => s + x, 0) / (v.length || 1);
    const ma = mean(da);
    const mb = mean(db);
    const r = [];
    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let sab = 0; let saa = 0; let sbb = 0;
        for (let i = 0; i < da.length; i++) {
            const j = i - lag;
            if (j < 0 || j >= db.length) continue;
            const x = da[i] - ma; const y = db[j] - mb;
            sab += x * y; saa += x * x; sbb += y * y;
        }
        r.push(saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0);
    }
    let k = 0;
    for (let i = 1; i < r.length; i++) if (r[i] > r[k]) k = i;
    // parabolic refinement between neighbours
    let frac = 0;
    if (k > 0 && k < r.length - 1) { const den = r[k - 1] - 2 * r[k] + r[k + 1]; if (den < 0) frac = 0.5 * (r[k - 1] - r[k + 1]) / den; }
    return { lag: k - maxLag + frac, score: r[k] };
}

/**
 * Sample the camera and the reference together on the box's render clock (one SerialFrame batch:
 * both thumbnails in the same frame, then Sleep), correlate their brightness changes, and move the
 * delay onto the input that is early. Screenshots are tiny but still cost the box some GPU, so this is
 * refused while the box is on air.
 */
async function measureAlign(b, link) {
    const ins = await videoInputs(link);
    const sel = alignSel(b, ins.map((i) => i.inputName), ins);
    if (!sel.cam || !sel.ref || sel.cam === sel.ref) throw fail('Pick a camera and a different reference input');
    if (await deps.onAir(b)) throw fail('Not while this box is on air: the measurement takes frames on the box');
    const v = await link.request('GetVideoSettings');
    const fps = v.fpsDenominator ? v.fpsNumerator / v.fpsDenominator : 30;
    const every = Math.max(1, Math.round(fps / 30)); // ~30 samples a second
    const count = 240;
    const shot = (name) => ({ requestType: 'GetSourceScreenshot', requestData: { sourceName: name, imageFormat: 'jpg', imageWidth: 32, imageHeight: 18, imageCompressionQuality: 70 } });
    const reqs = [];
    for (let i = 0; i < count; i++) reqs.push(shot(sel.cam), shot(sel.ref), { requestType: 'Sleep', requestData: { sleepFrames: every } });
    const results = await link.batch(reqs, { executionType: 2, timeoutMs: 40000 });
    const cam = [];
    const ref = [];
    for (let i = 0; i + 1 < results.length; i += 3) {
        const a = results[i];
        const r = results[i + 1];
        if (!a || !r || !a.requestStatus || !a.requestStatus.result || !r.requestStatus || !r.requestStatus.result) continue;
        cam.push(await lumaOf(a.responseData.imageData));
        ref.push(await lumaOf(r.responseData.imageData));
    }
    if (cam.length < 60) throw fail('The box returned too few frames to measure');
    const sampleMs = (every * 1000) / fps;
    const { lag, score } = bestLag(cam, ref, Math.round(1000 / sampleMs));
    // cam[i] ~ ref[i - lag]: lag > 0 means the camera shows a moment later than the game (camera late)
    const offMs = Math.round(lag * sampleMs);
    if (score < 0.3) return { ok: false, score, text: 'NO MATCH: play / flash', short: 'NO MATCH' };
    let camD = await delayOf(link, sel.cam);
    let refD = await delayOf(link, sel.ref);
    if (Math.abs(offMs) < sampleMs / 2) return { ok: true, score, offMs, text: `IN SYNC (\u00b1${Math.round(sampleMs / 2)} ms)`, short: 'IN SYNC' };
    if (offMs > 0) { const take = Math.min(camD, offMs); camD -= take; refD += offMs - take; } else { const off = -offMs; const take = Math.min(refD, off); refD -= take; camD += off - take; }
    await setDelay(link, sel.cam, camD);
    await setDelay(link, sel.ref, refD);
    return { ok: true, score, offMs, text: `${offMs > 0 ? 'CAM LATE' : 'CAM EARLY'} ${Math.abs(offMs)} ms \u2192 SET`, short: `${offMs > 0 ? '+' : ''}${offMs} ms` };
}

/** Actual picture rate of each video input: thumbnails on every box frame for ~2 s, count the changes. */
async function measureFps(b, link) {
    if (await deps.onAir(b)) throw fail('Not while this box is on air: the measurement takes frames on the box');
    const ins = await videoInputs(link);
    const v = await link.request('GetVideoSettings');
    const fps = v.fpsDenominator ? v.fpsNumerator / v.fpsDenominator : 30;
    const frames = Math.round(fps * 2);
    const out = [];
    for (const inp of ins.slice(0, 8)) {
        const reqs = [];
        for (let i = 0; i < frames; i++) reqs.push({ requestType: 'GetSourceScreenshot', requestData: { sourceName: inp.inputName, imageFormat: 'jpg', imageWidth: 32, imageHeight: 18, imageCompressionQuality: 80 } }, { requestType: 'Sleep', requestData: { sleepFrames: 1 } });
        const res = await link.batch(reqs, { executionType: 2, timeoutMs: 20000 });
        const shots = res.filter((r) => r.requestType === 'GetSourceScreenshot' && r.requestStatus && r.requestStatus.result).map((r) => r.responseData.imageData);
        let changes = 0;
        for (let i = 1; i < shots.length; i++) if (shots[i] !== shots[i - 1]) changes++;
        let target = null;
        if (inp.inputKind === 'dshow_input') {
            const st = ((await link.request('GetInputSettings', { inputName: inp.inputName }).catch(() => ({}))).inputSettings) || {};
            if (Number(st.res_type) === 1 && Number(st.frame_interval) > 0) target = Math.round(1e9 / Number(st.frame_interval)) / 100;
        }
        const measured = shots.length > 10 ? Math.round(((changes / (shots.length - 1)) * fps) * 10) / 10 : null;
        out.push({ name: inp.inputName, fps: changes < 3 ? null : measured, target });
    }
    return out;
}

// ------------------------------------------------------------------ view + keys

function frame(b) { return b.stack[b.stack.length - 1]; }

async function render(b) {
    const out = { box: { id: b.id, name: boxName(b), kind: b.kind }, open: b.open, info: b.info, toast: Date.now() - b.toastAt < 4000 ? b.toast : '', rev: ++b.rev, at: Date.now() };
    let target = null;
    let link = null;
    try { ({ link, target } = await linkOf(b)); } catch (e) { out.offline = e.message; }
    if (b.open && link) {
        const f = frame(b);
        try {
            const page = await PAGES[f.page](b, link, f, target);
            f.cursor = Math.max(0, Math.min(f.cursor || 0, page.rows.length - 1));
            const first = Math.max(0, Math.min(f.cursor - Math.floor(PAGE_ROWS / 2), page.rows.length - PAGE_ROWS));
            out.page = { id: f.page, title: page.title, crumbs: b.stack.map((x) => x.page), hint: (page.rows[f.cursor] && page.rows[f.cursor].hint) || page.hint || '', cursor: f.cursor, first, total: page.rows.length, rows: page.rows.slice(first, first + PAGE_ROWS) };
            f.rows = page.rows;
        } catch (e) { out.page = { id: f.page, title: f.page.toUpperCase(), rows: [], error: e.message }; }
    }
    if (b.info && link) {
        try {
            const [v, st, pg] = await Promise.all([link.request('GetVideoSettings'), link.request('GetStats'), link.request('GetCurrentProgramScene')]);
            out.strip = { format: `${v.outputHeight}p${fpsText(v.fpsNumerator, v.fpsDenominator)}`, fps: round1(st.activeFps || 0), cpu: round1(st.cpuUsage || 0), frame: round1(st.averageFrameRenderTime || 0), program: pg.currentProgramSceneName, addr: target ? target.host : '' };
        } catch (_) { out.strip = null; }
    }
    b.view = out;
    for (const res of b.subs) { try { res.write(`data: ${JSON.stringify(out)}\n\n`); } catch (_) { b.subs.delete(res); } }
    return out;
}

function toast(b, text) { b.toast = text; b.toastAt = Date.now(); }

async function onKey(b, key) {
    const { link } = await linkOf(b);
    if (key === 'menu') {
        if (b.open) { b.open = false; b.stack = []; b.pending.clear(); } else { b.open = true; b.stack = [{ page: 'main', cursor: 0 }]; }
        return;
    }
    if (key === 'info') { b.info = !b.info; return; }
    if (key === 'diag') { if (!b.open) b.open = true; b.stack = [{ page: 'main', cursor: 5 }, { page: 'diag', cursor: 0 }]; return; }
    if (!b.open) { if (key === 'exit' && b.info) b.info = false; return; }
    const f = frame(b);
    if (key === 'exit') {
        b.pending.clear();
        b.stack.pop();
        if (!b.stack.length) b.open = false;
        return;
    }
    if (!f.rows) await render(b);
    const rows = f.rows || [];
    const row = rows[f.cursor || 0];
    if (key === 'up') { f.cursor = (f.cursor + rows.length - 1) % Math.max(1, rows.length); return; }
    if (key === 'down') { f.cursor = (f.cursor + 1) % Math.max(1, rows.length); return; }
    if (!row) return;
    const name = row.id.slice(row.id.indexOf(':') + 1);
    const dir = key === 'left' ? -1 : key === 'right' ? 1 : 0;
    if (row.kind === 'nav' && key === 'ok') { b.stack.push({ page: row.id, cursor: 0 }); return; }
    if (row.id.startsWith('port:')) {
        const inp = (await portInputs(link)).find((i) => i.inputName === name);
        if (!inp) return;
        const prop = PORTS[inp.inputKind].prop;
        const opts = await portOptions(link, inp);
        if (!opts.length) return;
        const cur = ((await link.request('GetInputSettings', { inputName: name })).inputSettings || {})[prop];
        const pend = b.pending.has(row.id) ? b.pending.get(row.id) : cur;
        if (dir) {
            const i = opts.findIndex((o) => o.value === pend);
            b.pending.set(row.id, opts[(i + dir + opts.length) % opts.length].value);
        } else if (key === 'ok' && b.pending.has(row.id)) {
            const v = b.pending.get(row.id);
            b.pending.delete(row.id);
            await link.request('SetInputSettings', { inputName: name, inputSettings: { [prop]: v }, overlay: true });
            const o = opts.find((x) => x.value === v);
            toast(b, `${name} ← ${o ? o.text : v}`);
        }
        return;
    }
    if ((row.id === 'al:cam' || row.id === 'al:ref') && dir) {
        const ins = await videoInputs(link);
        const names = ins.map((i) => i.inputName);
        const sel = alignSel(b, names, ins);
        const k = row.id === 'al:cam' ? 'cam' : 'ref';
        const i = names.indexOf(sel[k]);
        sel[k] = names[(i + dir + names.length) % names.length];
        return;
    }
    if (row.id === 'fm:go' && key === 'ok') {
        if (b.fpsm && b.fpsm.running) return;
        b.fpsm = { running: true, results: (b.fpsm && b.fpsm.results) || [] };
        void measureFps(b, link)
            .then((r) => { b.fpsm = { results: r, at: Date.now() }; toast(b, 'Input frame rates measured'); })
            .catch((e) => { b.fpsm = { error: e.message, results: [] }; toast(b, e.message); })
            .finally(() => { void render(b).catch(() => {}); });
        return;
    }
    if (row.id === 'al:go' && key === 'ok') {
        if (b.align && b.align.running) return;
        b.align = { running: true, until: Date.now() + 9000 };
        toast(b, 'AUTO ALIGN: measuring...');
        void measureAlign(b, link)
            .then((r) => { b.align = { result: r }; toast(b, `AUTO ALIGN: ${r.text}`); })
            .catch((e) => { b.align = { error: e.message }; toast(b, `AUTO ALIGN: ${e.message}`); })
            .finally(() => { void render(b).catch(() => {}); });
        return;
    }
    if (row.id.startsWith('delay:') && dir) { const ms = await setDelay(link, name, (await delayOf(link, name)) + dir * 10); toast(b, `${name} video delay ${ms} ms`); return; }
    if (row.id.startsWith('sync:') && dir) {
        const cur = (await link.request('GetInputAudioSyncOffset', { inputName: name })).inputAudioSyncOffset || 0;
        await link.request('SetInputAudioSyncOffset', { inputName: name, inputAudioSyncOffset: Math.max(-950, Math.min(20000, cur + dir * 10)) });
        return;
    }
    if (row.id.startsWith('vol:')) {
        if (key === 'ok') { await link.request('ToggleInputMute', { inputName: name }); return; }
        if (dir) {
            const v = await link.request('GetInputVolume', { inputName: name });
            const db = Math.max(-60, Math.min(20, (v.inputVolumeDb <= -100 ? -60 : Math.round(v.inputVolumeDb)) + dir));
            await link.request('SetInputVolume', { inputName: name, inputVolumeDb: db <= -60 ? -100 : db });
        }
        return;
    }
    if (row.id.startsWith('scene:') && key === 'ok') { await link.request('SetCurrentProgramScene', { sceneName: name }); toast(b, `PGM ← ${name}`); return; }
    if (row.id === 'fps') {
        const v = await link.request('GetVideoSettings');
        const cur = b.pending.get('fps') || [v.fpsNumerator, v.fpsDenominator];
        if (dir) {
            let i = FPS_CHOICES.findIndex((c) => c[0] === cur[0] && c[1] === cur[1]);
            if (i < 0) i = 3;
            b.pending.set('fps', FPS_CHOICES[(i + dir + FPS_CHOICES.length) % FPS_CHOICES.length]);
        } else if (key === 'ok' && b.pending.has('fps')) {
            const [n, d] = b.pending.get('fps');
            b.pending.delete('fps');
            try {
                await link.request('SetVideoSettings', { fpsNumerator: n, fpsDenominator: d });
                toast(b, `Frame rate ${fpsText(n, d)} fps`);
            } catch (e) {
                // an always-on output (NDI) holds the video pipeline: save it in the profile for the next start
                await link.request('SetProfileParameter', { parameterCategory: 'Video', parameterName: 'FPSType', parameterValue: '2' }).catch(() => {});
                await link.request('SetProfileParameter', { parameterCategory: 'Video', parameterName: 'FPSNum', parameterValue: String(n) }).catch(() => {});
                await link.request('SetProfileParameter', { parameterCategory: 'Video', parameterName: 'FPSDen', parameterValue: String(d) }).catch(() => {});
                toast(b, `${fpsText(n, d)} fps saved: applies when OBS restarts (outputs active)`);
            }
        }
    }
}

const KEYS = new Set(['up', 'down', 'left', 'right', 'ok', 'menu', 'diag', 'info', 'exit']);

/** A remote key press for a box: returns the view (also pushed to the box's OSD page). */
async function press(target, cabinetId, key) {
    if (!KEYS.has(key)) throw fail('Unknown key', 'AVOSD_KEY');
    const b = await resolveBox(target, cabinetId);
    if (b.busy) return b.view || render(b);
    b.busy = true;
    try {
        const wasUp = b.open || b.info;
        try { await onKey(b, key); } catch (e) { toast(b, `ERROR: ${e.message}`); }
        const up = b.open || b.info;
        if (up !== wasUp || up) { try { await placeOverlay(b); } catch (e) { toast(b, `OSD layer: ${e.message}`); } }
        return await render(b);
    } finally { b.busy = false; }
}

/** The current view (QuickCast polls it for the remote's LCD line). */
async function view(target, cabinetId) {
    const b = await resolveBox(target, cabinetId);
    return b.view || { box: { id: b.id, name: boxName(b), kind: b.kind }, open: b.open, info: b.info };
}

/** For avOsdHttp: an OSD page subscribes to its box. */
function subscribe(boxId, k, res) {
    if (!validId(boxId) || !checkToken(boxId, k)) return false;
    const b = box(boxId);
    b.subs.add(res);
    res.write(`data: ${JSON.stringify(b.view || { box: { id: b.id, name: boxName(b), kind: b.kind }, open: false, info: false })}\n\n`);
    return () => b.subs.delete(res);
}

// keep an open OSD's numbers fresh (levels, clock, diagnostics) while something shows it
setInterval(() => {
    for (const b of boxes.values()) if ((b.open || b.info) && !b.busy) void render(b).catch(() => {});
}, 1500).unref();

module.exports = { init, press, view, subscribe, checkToken, PORTS, bestLag, _boxes: boxes, OVERLAY_SCENE, OVERLAY_INPUT, DELAY_FILTER };
