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

// ------------------------------------------------------------------ latched faults survive restarts

function faultFile() { return path.join(deps.dataDir, 'faults.json'); }
function loadFaults() { try { return JSON.parse(fs.readFileSync(faultFile(), 'utf8')) || {}; } catch (_) { return {}; } }
function saveFault(b) {
    const all = loadFaults();
    if (b.fault) all[b.id] = b.fault; else delete all[b.id];
    try { fs.mkdirSync(deps.dataDir, { recursive: true }); fs.writeFileSync(faultFile(), JSON.stringify(all, null, 2)); } catch (_) { /* best effort */ }
}

// ------------------------------------------------------------------ boxes

const boxes = new Map(); // id -> box

const fail = (message, code) => Object.assign(new Error(message), { code: code || 'AVOSD_ERROR' });
const validId = (id) => /^(sat|mux-[A-Za-z0-9 ._-]{1,40})$/.test(id);

function box(id) {
    if (!validId(id)) throw fail('Unknown box', 'AVOSD_BOX');
    let b = boxes.get(id);
    if (!b) {
        b = { fault: loadFaults()[id] || null, id, kind: id === 'sat' ? 'satellite' : 'cabinet', machine: id === 'sat' ? '' : id.slice(4), open: false, info: false, stack: [], toast: '', toastAt: 0, rev: 0, subs: new Set(), view: null, pending: new Map(), busy: false };
        boxes.set(id, b);
    }
    return b;
}

async function linkOf(b) {
    let r;
    if (b.kind === 'satellite') {
        await deps.ruiko.connect();
        const o = deps.readConfig().obs;
        r = { link: deps.ruiko, target: { host: o.host, port: Number(o.port) || 4455 } };
    } else r = await deps.diag.muxLink(b.machine);
    hookUnit(b, r.link);
    return r;
}

const machineCache = new Map(); // cabinetId -> { machine, at }

/** First contact with a unit after a server start: a stale OSD layer left on (menu state is not kept
 *  across restarts) is taken off its program. */
async function settle(b) {
    if (b.settled) return;
    b.settled = true;
    try {
        // once per server start: reload the unit's OSD page (it may be an older build, or a dead stream)
        const { link } = await linkOf(b);
        await link.request('PressInputPropertiesButton', { inputName: OVERLAY_INPUT, propertyName: 'refreshnocache' }).catch(() => {});
        await placeOverlay(b);
    } catch (_) { /* unit offline */ }
}

/** The box a QuickCast remote is pointed at: the satellite, or the mux PC feeding a cabinet. */
async function resolveBox(target, cabinetId) {
    if (target === 'sat') return box('sat');
    const hit = machineCache.get(cabinetId);
    let machine = hit && Date.now() - hit.at < 30000 ? hit.machine : '';
    if (!machine) { machine = await deps.diag.machineForCabinet(cabinetId); machineCache.set(cabinetId, { machine, at: Date.now() }); }
    if (!machine) throw fail('This cabinet\'s scene on the satellite has no NDI feed, so there is no mux box to control', 'AVOSD_NOMUX');
    const b = box(`mux-${machine}`);
    if (cabinetId) b.cabinet = cabinetId; // its XLink device (front panel XLINK)
    return b;
}

/** The unit's own name, as on the panels (the satellite's configured name, a mux PC's NDI machine name). */
function boxName(b) { return b.kind === 'satellite' ? deps.satelliteName() : b.machine.toUpperCase(); }
function boxModel(b) { try { return deps.unitModel(boxName(b)) || ''; } catch (_) { return ''; } }

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
    // the OSD layer is resident on the unit's program (transparent when idle), so the unit can still draw
    // its own "XLink GMS communication lost" OSD when this server is unreachable
    const want = true;
    const { link } = await linkOf(b);
    if (want) await ensureOverlay(b, link);
    const program = (await link.request('GetCurrentProgramScene')).currentProgramSceneName;
    if (!program || program === OVERLAY_SCENE) return;
    const items = (await link.request('GetSceneItemList', { sceneName: program })).sceneItems || [];
    const it = items.find((i) => i.sourceName === OVERLAY_SCENE);
    if (want && (!it || !it.sceneItemEnabled)) {
        // a page that lost its stream (server restarted) would draw nothing: reload it as the layer comes up
        await link.request('PressInputPropertiesButton', { inputName: OVERLAY_INPUT, propertyName: 'refreshnocache' }).catch(() => {});
    }
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

const optCache = new Map(); // link label + input -> { at, opts }: device lists change rarely, and ask slowly

async function portOptions(link, inp) {
    const prop = PORTS[inp.inputKind].prop;
    const ck = `${link.label}|${inp.inputName}`;
    const c = optCache.get(ck);
    if (c && Date.now() - c.at < 30000) return c.opts;
    try {
        const r = await link.request('GetInputPropertiesListPropertyItems', { inputName: inp.inputName, propertyName: prop });
        const opts = (r.propertyItems || []).filter((o) => o.itemEnabled !== false).map((o) => ({ value: o.itemValue, text: String(o.itemName || o.itemValue || '-') }));
        optCache.set(ck, { at: Date.now(), opts });
        return opts;
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
                (() => { const act = b.fault ? b.fault.items.filter((i) => !i.bypass).length : 0; const byp = b.fault ? b.fault.items.length - act : 0; return { id: 'alarms', label: 'ALARMS', kind: 'nav', value: act ? `${act} ACTIVE${b.fault.overridden ? ' (OVR)' : ''}` : byp ? `${byp} BYPASSED` : 'NONE', state: act ? (b.fault.overridden ? 'warn' : 'bad') : byp ? 'warn' : 'ok', blink: !!(act && !b.fault.overridden) }; })(),
                { id: 'inputs', label: 'INPUT ASSIGNMENT', kind: 'nav', value: '' },
                { id: 'timing', label: 'TIMING / SYNC', kind: 'nav', value: '' },
                { id: 'cameras', label: 'CAMERA CONTROL', kind: 'nav', value: '' },
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
        const got = await Promise.all(ins.map((inp) => Promise.all([
            link.request('GetInputSettings', { inputName: inp.inputName }).catch(() => ({ inputSettings: {} })),
            portOptions(link, inp)
        ])));
        const rows = [];
        for (let n = 0; n < ins.length; n++) {
            const inp = ins[n];
            const prop = PORTS[inp.inputKind].prop;
            const set = got[n][0].inputSettings || {};
            const opts = got[n][1];
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
            // bars: video delay on a 0..500 ms scale; audio sync centred on zero (-250..+250 ms)
            rows.push({ id: `delay:${inp.inputName}`, label: `${inp.inputName} VIDEO`, kind: 'adjust', value: `${f} ms`, bar: { from: 0, width: Math.min(100, f / 5), color: f ? '#ffc23a' : '#555' }, hint: 'Video delay — ◄► 10 ms' });
            if (sync != null) rows.push({ id: `sync:${inp.inputName}`, label: `${inp.inputName} AUDIO`, kind: 'adjust', value: `${sync > 0 ? '+' : ''}${sync} ms`, bar: { from: sync >= 0 ? 50 : Math.max(0, 50 + sync / 5), width: Math.max(1, Math.min(50, Math.abs(sync) / 5)), color: sync ? '#3ea0ff' : '#555' }, hint: 'Audio sync offset — ◄► 10 ms' });
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

    /** XLINK: the cabinet's XLink menu (power, volume, ...) drawn on the unit's own output. */
    async xlink(b, link, f) {
        if (!b.cabinet) return { title: 'XLINK', rows: [{ id: 'none', label: 'NO CABINET FOR THIS UNIT', kind: 'info', value: '' }] };
        const menu = await xlinkMenu(b);
        if (!menu.available) return { title: 'XLINK', rows: [{ id: 'none', label: 'NO XLINK DEVICE', kind: 'info', value: '' }] };
        let list = menu.items;
        const crumbs = [menu.device.name];
        for (const i of f.path || []) { crumbs.push(list[i].text); list = list[i].children || []; }
        const rows = list.map((n, i) => {
            const pathKey = `xl:${[...(f.path || []), i].join('.')}`;
            const st = n.status && n.status.text ? n.status.text : '';
            if (n.kind === 'folder') return { id: `${pathKey}`, xl: 'folder', label: n.text, kind: 'nav', value: st };
            if (n.kind === 'toggle') {
                const act = Math.max(0, n.toggle.findIndex((o) => o.active));
                const pend = b.pending.has(pathKey) ? b.pending.get(pathKey) : act;
                return { id: pathKey, xl: 'toggle', label: n.text, kind: 'pick', value: n.toggle.map((o, k) => (k === pend ? `[${o.label || '-'}]` : o.label || '-') + (o.active ? '*' : '')).join(' '), changed: pend !== act, hint: `${st ? `${st}  ` : ''}\u25c4\u25ba choose, OK apply` };
            }
            if (n.kind === 'button') return { id: pathKey, xl: 'button', label: n.text, kind: 'action', value: st || 'OK', hint: 'OK sends' };
            return { id: pathKey, xl: 'info', label: n.text, kind: 'info', value: st };
        });
        const c = b.xlConfirm && Date.now() < b.xlConfirm.until ? b.xlConfirm : null;
        return { title: `XLINK  ${crumbs.slice(-1)[0]}`.toUpperCase(), rows: rows.length ? rows : [{ id: 'none', label: 'NO ITEMS', kind: 'info', value: '' }], hint: c ? `OK AGAIN: ${c.msg}` : 'Cabinet controls (XLink GMS)' };
    },

    async alarms(b) {
        const f = b.fault;
        const last = b.lastPost ? new Date(b.lastPost.at).toTimeString().slice(0, 8) : '';
        if (!f) {
            return {
                title: 'ALARMS',
                rows: [
                    { id: 'none', label: 'NO ACTIVE ALARMS', kind: 'info', value: last ? `TESTED ${last}` : '', state: 'ok' },
                    { id: 'f:retest', label: 'RUN SELF TEST', kind: 'action', value: '', hint: 'Boot screen and power-on self test on this unit\'s output' }
                ]
            };
        }
        // OK on an alarm bypasses the input: it is switched off in every scene that shows it (and back on)
        const rows = f.items.map((x, i) => ({
            id: `f:${i}`, label: x.label, type: x.type, kind: 'action',
            value: x.bypass ? 'BYPASSED' : x.detail, state: x.bypass ? 'warn' : f.overridden ? 'warn' : 'bad', blink: !x.bypass && !f.overridden,
            hint: x.bypass ? `OK: put ${x.label} back in its ${x.bypass.length} scene${x.bypass.length === 1 ? '' : 's'}` : `OK: bypass ${x.label} (switch it off in the scenes that show it)`
        }));
        rows.push({ id: 'f:retest', label: 'RE-RUN SELF TEST', kind: 'action', value: '', hint: 'After fixing the source: test again; a clean test clears the fault' });
        rows.push({ id: 'f:override', label: f.overridden ? 'OVERRIDDEN (AIRING WITH FAULT)' : 'OVERRIDE: AIR WITH FAULT', kind: 'action', value: f.overridden ? 'ON' : '', state: f.overridden ? 'warn' : '', hint: 'Technician only: clears the DO NOT AIR lock without fixing the fault' });
        rows.push({ id: 'inputs', label: 'INPUT ASSIGNMENT', kind: 'nav', value: '' });
        rows.push({ id: 'cameras', label: 'CAMERA CONTROL', kind: 'nav', value: '' });
        return { title: 'ALARMS', rows, hint: `Self test ${new Date(f.at).toTimeString().slice(0, 8)}: fix the source (cable, device, port), then RE-RUN SELF TEST` };
    },

    async cameras(b, link) {
        const cams = (await link.request('GetInputList')).inputs.filter((i) => CAMERA_KINDS.has(i.inputKind) && i.inputName !== OVERLAY_INPUT);
        const rows = cams.map((c) => ({ id: `cam:${c.inputName}`, label: c.inputName, kind: 'nav', value: PORTS[c.inputKind] ? PORTS[c.inputKind].type : '' }));
        return { title: 'CAMERA CONTROL', rows: rows.length ? rows : [{ id: 'none', label: 'No cameras on this unit', kind: 'info', value: '' }] };
    },

    async cam(b, link, f) {
        const name = f.arg;
        const set = (await link.request('GetInputSettings', { inputName: name })).inputSettings || {};
        const amp = await procAmp(link, name);
        const res = await listOpts(link, name, 'resolution');
        const fpsList = await listOpts(link, name, 'frame_interval');
        const pend = (k) => b.pending.get(`${k}:${name}`);
        const curRes = pend('res') != null ? pend('res') : set.resolution;
        const curFi = pend('fi') != null ? pend('fi') : set.frame_interval;
        const fiText = (fi) => { const o = fpsList.find((x) => String(x.value) === String(fi)); return o ? o.text : fi > 0 ? `${Math.round(1e9 / fi) / 100} fps` : 'DEVICE DEFAULT'; };
        const pct = (v, lo, hi) => ({ from: 0, width: Math.max(1, Math.min(100, ((v - lo) / (hi - lo)) * 100)), color: '#3ea0ff' });
        return {
            title: name.toUpperCase(),
            rows: [
                { id: `cres:${name}`, label: 'RESOLUTION', kind: 'pick', value: curRes || 'DEVICE DEFAULT', changed: pend('res') != null && pend('res') !== set.resolution, hint: res.length ? '\u25c4\u25ba choose, OK apply (the camera re-locks)' : 'The device lists no formats' },
                { id: `cfps:${name}`, label: 'FRAME RATE', kind: 'pick', value: fiText(curFi), changed: pend('fi') != null && String(pend('fi')) !== String(set.frame_interval), hint: fpsList.length ? '\u25c4\u25ba choose, OK apply' : 'The device lists no rates' },
                { id: `amp:brightness:${name}`, label: 'BRIGHTNESS', kind: 'adjust', value: amp.brightness.toFixed(2), bar: pct(amp.brightness, -1, 1), hint: 'Proc amp \u2014 \u25c4\u25ba' },
                { id: `amp:contrast:${name}`, label: 'CONTRAST', kind: 'adjust', value: amp.contrast.toFixed(2), bar: pct(amp.contrast, -2, 2), hint: 'Proc amp \u2014 \u25c4\u25ba' },
                { id: `amp:gamma:${name}`, label: 'GAMMA / EXPOSURE', kind: 'adjust', value: amp.gamma.toFixed(2), bar: pct(amp.gamma, -3, 3), hint: 'Lifts or lowers the mid tones like an exposure trim \u2014 \u25c4\u25ba' },
                { id: `amp:saturation:${name}`, label: 'SATURATION', kind: 'adjust', value: amp.saturation.toFixed(2), bar: pct(amp.saturation, -1, 3), hint: 'Proc amp \u2014 \u25c4\u25ba' },
                { id: `amp:hue_shift:${name}`, label: 'HUE', kind: 'adjust', value: `${Math.round(amp.hue_shift)}\u00b0`, bar: pct(amp.hue_shift, -180, 180), hint: 'Proc amp \u2014 \u25c4\u25ba' },
                { id: `amp:reset:${name}`, label: 'PROC AMP RESET', kind: 'action', value: '', hint: 'OK sets the proc amp back to unity' },
                (() => {
                    const saved = flashFor(b.id)[name];
                    return { id: `csave:${name}`, label: 'SAVE TO FLASH', kind: 'action', value: saved ? `SAVED ${new Date(saved.at).toTimeString().slice(0, 5)}` : 'NOT SAVED', state: saved ? 'ok' : '', hint: 'OK stores this format and proc amp as the boot values (applied at every power on / reset)' };
                })(),
                (() => {
                    const saved = flashFor(b.id)[name];
                    return { id: `cboot:${name}`, label: 'BOOT VALUES', kind: 'action', value: saved ? [saved.resolution, saved.fpsText].filter(Boolean).join(' ') || 'PROC AMP' : '-', hint: saved ? 'OK loads the boot values now (CLEAR with \u25c4)' : 'Nothing stored yet' };
                })()
            ],
            hint: 'Format on the camera; proc amp in the mixer'
        };
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
            { id: 'active', label: 'RUNNING', kind: 'info', value: `${round1(st.activeFps || 0)} fps`, state: st.activeFps < (cur[0] / cur[1]) * 0.97 ? 'bad' : 'ok', blink: st.activeFps < (cur[0] / cur[1]) * 0.97, bar: { from: 0, width: Math.min(100, ((st.activeFps || 0) / (cur[0] / cur[1])) * 100), color: st.activeFps < (cur[0] / cur[1]) * 0.97 ? '#ff4b4b' : '#3ee07a' } },
            { id: 'ftime', label: 'FRAME TIME', kind: 'info', value: `${round1(st.averageFrameRenderTime || 0)} / ${round1(1000 / (cur[0] / cur[1]))} ms`, bar: { from: 0, width: Math.min(100, ((st.averageFrameRenderTime || 0) / (1000 / (cur[0] / cur[1]))) * 100), color: (st.averageFrameRenderTime || 0) > (900 / (cur[0] / cur[1])) ? '#ffc23a' : '#3ee07a' } }
        ];
        if (b.kind === 'cabinet') rows.push({ id: 'lock', label: 'LOCK TO SATELLITE', kind: 'info', value: sat == null ? '-' : lock ? `${lock} LOCKED` : `NO LOCK (${fpsText(sat * 1000, 1000)})`, state: sat != null && !lock ? 'bad' : sat != null ? 'ok' : '', blink: sat != null && !lock, bar: sat == null ? null : { from: 0, width: 100, color: lock ? '#3ee07a' : '#ff4b4b' } });
        return { title: 'VIDEO CLOCK', rows };
    },

    /** DIAGNOSTICS: read live from the unit (clock, frame times, drops, load), then the pipeline stages. */
    async diag(b, link) {
        const [st, v] = await Promise.all([link.request('GetStats'), link.request('GetVideoSettings')]);
        const fps = v.fpsDenominator ? v.fpsNumerator / v.fpsDenominator : 0;
        const budget = fps ? 1000 / fps : 0;
        const now = Date.now();
        let stream = null;
        if (b.kind === 'satellite') { try { stream = await link.request('GetStreamStatus'); } catch (_) { stream = null; } }
        // deltas against the previous read of this page (every ~2 s while it is shown)
        const cur = { at: now, rs: st.renderSkippedFrames || 0, rt: st.renderTotalFrames || 0, os: st.outputSkippedFrames || 0, ot: st.outputTotalFrames || 0, ns: stream ? stream.outputSkippedFrames || 0 : 0, nt: stream ? stream.outputTotalFrames || 0 : 0, nb: stream ? stream.outputBytes || 0 : 0 };
        const prev = b.diagPrev && now - b.diagPrev.at < 15000 && cur.rt >= b.diagPrev.rt ? b.diagPrev : null;
        b.diagPrev = cur;
        const pct = (a, t) => (t > 0 ? Math.round((a / t) * 1000) / 10 : 0);
        const recent = (k1, k2) => (prev ? pct(cur[k1] - prev[k1], cur[k2] - prev[k2]) : null);
        const lvl = (p) => (p == null ? '' : p >= 2 ? 'bad' : p >= 0.5 ? 'warn' : 'ok');
        const bar = (frac, state) => ({ from: 0, width: Math.max(1, Math.min(100, frac * 100)), color: state === 'bad' ? '#ff4b4b' : state === 'warn' ? '#ffc23a' : '#3ee07a' });
        const head = (label) => ({ id: `h:${label}`, label, kind: 'head', value: '' });
        const rows = [];
        // CLOCK
        rows.push(head('CLOCK'));
        rows.push({ id: 'dg:target', label: 'TARGET', kind: 'info', value: `${v.outputWidth}x${v.outputHeight} ${fps ? fps.toFixed(2) : '-'} FPS` });
        const act = round1(st.activeFps || 0);
        const clkSt = fps && act < fps * 0.97 ? 'bad' : 'ok';
        rows.push({ id: 'dg:run', label: 'RUNNING', kind: 'info', value: `${act} FPS`, state: clkSt, blink: clkSt === 'bad', bar: bar(fps ? act / fps : 0, clkSt) });
        const pick = (() => {
            for (const cab of deps.readConfig().cabinets.map((c) => c.id)) {
                const d = deps.diag.lastFor(cab);
                if (!d) continue;
                if (b.kind === 'satellite') return d.output;
                if (d.input && d.input.source === b.machine) return d.input;
            }
            return null;
        })();
        const stage = (id) => pick && (pick.stages || []).find((x) => x.id === id);
        const lock = stage(b.kind === 'satellite' ? 'rx' : 'lock');
        if (lock) rows.push({ id: 'dg:lock', label: b.kind === 'satellite' ? 'NDI INPUT' : 'LOCK TO SATELLITE', kind: 'info', value: lock.value, state: lock.state === 'ok' ? 'ok' : lock.state === 'bad' ? 'bad' : lock.state === 'warn' ? 'warn' : '', blink: lock.blink });
        // FRAME TIMES & DROPS
        rows.push(head('FRAME TIMES & DROPS'));
        const ft = round1(st.averageFrameRenderTime || 0);
        const ftSt = budget && ft > budget * 0.95 ? 'bad' : budget && ft > budget * 0.8 ? 'warn' : 'ok';
        rows.push({ id: 'dg:ft', label: 'FRAME TIME', kind: 'info', value: `${ft} / ${round1(budget)} MS`, state: ftSt, bar: bar(budget ? ft / budget : 0, ftSt) });
        const rr = recent('rs', 'rt');
        rows.push({ id: 'dg:rd', label: 'RENDER DROPS', kind: 'info', value: `${cur.rs} (${pct(cur.rs, cur.rt)}%)${rr != null ? ` NOW ${rr}%` : ''}`, state: lvl(rr != null ? rr : pct(cur.rs, cur.rt)), blink: (rr || 0) >= 2 });
        const er = recent('os', 'ot');
        rows.push({ id: 'dg:ed', label: 'ENCODE DROPS', kind: 'info', value: `${cur.os} (${pct(cur.os, cur.ot)}%)${er != null ? ` NOW ${er}%` : ''}`, state: lvl(er != null ? er : pct(cur.os, cur.ot)), blink: (er || 0) >= 2 });
        if (stream && stream.outputActive) {
            const nr = recent('ns', 'nt');
            rows.push({ id: 'dg:nd', label: 'NETWORK DROPS', kind: 'info', value: `${cur.ns} (${pct(cur.ns, cur.nt)}%)${nr != null ? ` NOW ${nr}%` : ''}`, state: lvl(nr != null ? nr : pct(cur.ns, cur.nt)), blink: (nr || 0) >= 2 });
        }
        // ENCODER / LOAD
        rows.push(head('ENCODER / LOAD'));
        const cpu = round1(st.cpuUsage || 0);
        const cpuSt = cpu > 85 ? 'bad' : cpu > 60 ? 'warn' : 'ok';
        rows.push({ id: 'dg:cpu', label: 'CPU LOAD', kind: 'info', value: `${cpu}%`, state: cpuSt, bar: bar(cpu / 100, cpuSt) });
        rows.push({ id: 'dg:lag', label: 'ENCODER LAG', kind: 'info', value: `${er != null ? er : pct(cur.os, cur.ot)}%`, state: lvl(er != null ? er : pct(cur.os, cur.ot)) });
        if (b.kind === 'satellite') {
            if (stream && stream.outputActive) {
                const kbps = prev && cur.nb >= prev.nb ? Math.round(((cur.nb - prev.nb) * 8) / (now - prev.at)) : null;
                rows.push({ id: 'dg:kbps', label: 'UPLINK BITRATE', kind: 'info', value: kbps == null ? '...' : `${kbps.toLocaleString('en-US')} KB/S` });
                const cg = Math.round((stream.outputCongestion || 0) * 100);
                rows.push({ id: 'dg:cong', label: 'CONGESTION', kind: 'info', value: `${cg}%`, state: cg > 60 ? 'bad' : cg > 25 ? 'warn' : 'ok', bar: bar(cg / 100, cg > 60 ? 'bad' : cg > 25 ? 'warn' : 'ok') });
            } else rows.push({ id: 'dg:air', label: 'UPLINK', kind: 'info', value: 'OFF AIR' });
        } else {
            const ndi = stage('ndiout');
            if (ndi) rows.push({ id: 'dg:ndi', label: 'NDI OUTPUT', kind: 'info', value: ndi.value, state: ndi.state === 'ok' ? 'ok' : ndi.state === 'bad' ? 'bad' : ndi.state === 'warn' ? 'warn' : '', blink: ndi.blink });
            const ln = stage('link');
            if (ln) rows.push({ id: 'dg:link', label: 'GMS LINK', kind: 'info', value: ln.value, state: ln.state === 'ok' ? 'ok' : ln.state === 'bad' ? 'bad' : ln.state === 'warn' ? 'warn' : '' });
        }
        rows.push({ id: 'dg:mem', label: 'MEMORY', kind: 'info', value: `${Math.round(st.memoryUsage || 0)} MB` });
        // PIPELINE
        if (pick && pick.stages && pick.stages.length) {
            rows.push(head('PIPELINE'));
            for (const x of pick.stages) rows.push({ id: `d:${x.id}`, label: x.label, kind: 'info', value: x.value, state: x.state === 'ok' ? 'ok' : x.state === 'bad' ? 'bad' : x.state === 'warn' ? 'warn' : '', blink: x.blink });
        }
        return { title: 'DIAGNOSTICS', rows, hint: 'Drops: total since the engine started, NOW = the last 2 s' };
    },

    async system(b, link, frame, target) {
        const ver = await link.request('GetVersion');
        const st = await link.request('GetStats');
        const v = await link.request('GetVideoSettings');
        return {
            title: 'SYSTEM INFORMATION',
            rows: [
                { id: 's:name', label: 'UNIT', kind: 'info', value: boxName(b) },
                { id: 's:model', label: 'MODEL', kind: 'info', value: boxModel(b) || '-' },
                { id: 's:role', label: 'TYPE', kind: 'info', value: (deps.unitInfo(boxName(b), b.kind === 'satellite' ? 'satellite' : 'mux').kind || '').toUpperCase() },
                { id: 's:addr', label: 'ADDRESS', kind: 'info', value: `${target.host}:${target.port}` },
                { id: 's:obs', label: 'ENGINE', kind: 'info', value: `ENGINE ${ver.obsVersion} / CTRL ${ver.obsWebSocketVersion}` },
                { id: 's:os', label: 'PLATFORM', kind: 'info', value: String(ver.platformDescription || ver.platform || '-').slice(0, 34) },
                { id: 's:fmt', label: 'FORMAT', kind: 'info', value: `${v.outputWidth}x${v.outputHeight} ${fpsText(v.fpsNumerator, v.fpsDenominator)}` },
                { id: 's:cpu', label: 'CPU', kind: 'info', value: `${round1(st.cpuUsage || 0)} %` },
                { id: 's:mem', label: 'MEMORY', kind: 'info', value: `${Math.round(st.memoryUsage || 0)} MB` },
                { id: 's:disk', label: 'DISK FREE', kind: 'info', value: `${round1((st.availableDiskSpace || 0) / 1024)} GB` },
                { id: 's:render', label: 'FRAME TIME', kind: 'info', value: `${round1(st.averageFrameRenderTime || 0)} ms` },
                { id: 's:post', label: 'RUN SELF TEST', kind: 'action', value: b.post ? 'RUNNING' : b.lastPost ? `${b.lastPost.alarms ? `${b.lastPost.alarms} ALARM` : 'PASSED'}` : '', state: b.lastPost ? (b.lastPost.alarms ? 'bad' : 'ok') : '', hint: 'Boot screen and power-on self test now (the unit shows it on its output)' },
                { id: 's:card', label: b.kind === 'satellite' ? 'LIVE STANDBY SLATES' : 'LIVE SYSTEM TEST CARD', kind: 'action', value: b.cardInstalled ? 'INSTALLED' : 'OK = INSTALL', state: b.cardInstalled ? 'ok' : '', hint: b.kind === 'satellite' ? 'Draws the standby slates behind each cabinet feed live (status bar shows the real link state)' : 'Draws the SysTest card live (real hardware I/O tiles and status)' }
            ]
        };
    }
};

const CAMERA_KINDS = new Set(['dshow_input', 'av_capture_input', 'av_capture_input_v2', 'v4l2_input']);
const AMP_FILTER = 'AV Proc Amp';
const AMP_STEP = { brightness: [0.02, -1, 1], contrast: [0.05, -2, 2], gamma: [0.05, -3, 3], saturation: [0.05, -1, 3], hue_shift: [2, -180, 180] };

async function procAmp(link, inputName) {
    const amp = { brightness: 0, contrast: 0, gamma: 0, saturation: 0, hue_shift: 0 };
    try {
        const f = await link.request('GetSourceFilter', { sourceName: inputName, filterName: AMP_FILTER });
        Object.keys(amp).forEach((k) => { if (f.filterSettings && f.filterSettings[k] != null) amp[k] = Number(f.filterSettings[k]) || 0; });
    } catch (_) { /* no proc amp yet: unity */ }
    return amp;
}

async function setProcAmp(link, inputName, settings) {
    let has = true;
    try { await link.request('GetSourceFilter', { sourceName: inputName, filterName: AMP_FILTER }); } catch (_) { has = false; }
    if (!has) await link.request('CreateSourceFilter', { sourceName: inputName, filterName: AMP_FILTER, filterKind: 'color_filter_v2', filterSettings: settings });
    else await link.request('SetSourceFilterSettings', { sourceName: inputName, filterName: AMP_FILTER, filterSettings: settings, overlay: true });
}

async function listOpts(link, inputName, prop) {
    try {
        const r = await link.request('GetInputPropertiesListPropertyItems', { inputName, propertyName: prop });
        return (r.propertyItems || []).filter((o) => o.itemEnabled !== false).map((o) => ({ value: o.itemValue, text: String(o.itemName || o.itemValue) }));
    } catch (_) { return []; }
}

// ------------------------------------------------------------------ XLINK on the unit OSD

const XL_RISKY = /power|shutdown|shut down|reboot|flush|takeover|maintenance|dispense|eject|wake|standby|reset/i;

/**
 * The cabinet's XLink menu for the XLINK page. Only the first read waits: after that the page draws from
 * the last menu at once and a fresh one is fetched in the background (XLink status reads are slow HTTP
 * calls to the cabinet, and keys must never queue behind them).
 */
async function xlinkMenu(b, force) {
    const fresh = () => deps.xlinkMenu(b.cabinet, !!force).then((m) => { b.xlMenu = m; b.xlMenuAt = Date.now(); return m; });
    if (force || !b.xlMenu) return fresh();
    if (Date.now() - b.xlMenuAt > 4000 && !b.xlFetching) {
        b.xlFetching = true;
        fresh().catch(() => {}).finally(() => { b.xlFetching = false; });
    }
    return b.xlMenu;
}

/** Run an XLink item from the OSD. Risky items and XLink's own warnings need a second OK (5 s), shown in the hint. */
async function xlinkRun(b, path, op, value, label) {
    const pathKey = `${path.join('.')}|${op}|${value}`;
    const c = b.xlConfirm && b.xlConfirm.key === pathKey && Date.now() < b.xlConfirm.until ? b.xlConfirm : null;
    if (!c && XL_RISKY.test(label)) {
        b.xlConfirm = { key: pathKey, until: Date.now() + 5000, msg: `${label}` };
        toast(b, `PRESS OK AGAIN: ${label}`, 'XLINK');
        return;
    }
    const r = await deps.xlinkDo({ cabinet: b.cabinet, path, op, value, confirmed: !!(c && c.xlinkWarned) || !!c });
    if (r.confirm && !c) {
        b.xlConfirm = { key: pathKey, until: Date.now() + 5000, msg: `${r.confirm.header}: ${r.confirm.message}`.slice(0, 60), xlinkWarned: true };
        toast(b, `PRESS OK AGAIN: ${r.confirm.header}`, 'XLINK', r.confirm.message);
        return;
    }
    b.xlConfirm = null;
    if (r.menu) { b.xlMenu = r.menu; b.xlMenuAt = Date.now(); }
    toast(b, r.ok === false ? `FAILED: ${label}` : `${label}: DONE`, 'XLINK', r.failure || '');
}

/** Switch an input off wherever it is on (scenes and groups); returns where, for putting it back. */
async function bypassInput(link, inputName) {
    const done = [];
    const scenes = ((await link.request('GetSceneList')).scenes || []).map((x) => x.sceneName).filter((n) => n !== OVERLAY_SCENE);
    const visit = async (name, group) => {
        const items = (await link.request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName: name }).catch(() => ({}))).sceneItems || [];
        for (const it of items) {
            if (it.isGroup) { await visit(it.sourceName, true); continue; }
            if (it.sourceName === inputName && it.sceneItemEnabled) {
                await link.request('SetSceneItemEnabled', { sceneName: name, sceneItemId: it.sceneItemId, sceneItemEnabled: false });
                done.push({ scene: name, id: it.sceneItemId });
            }
        }
    };
    for (const n of scenes) await visit(n, false);
    return done;
}

// ------------------------------------------------------------------ camera flash (boot values)

function flashFile() { return path.join(deps.dataDir, 'camera-flash.json'); }
function flashAll() { try { return JSON.parse(fs.readFileSync(flashFile(), 'utf8')) || {}; } catch (_) { return {}; } }
function flashFor(boxId) { return flashAll()[boxId] || {}; }
function flashWrite(boxId, cams) {
    const all = flashAll();
    if (Object.keys(cams).length) all[boxId] = cams; else delete all[boxId];
    fs.mkdirSync(deps.dataDir, { recursive: true });
    fs.writeFileSync(flashFile(), JSON.stringify(all, null, 2));
}

/** Store a camera's current format and proc amp as its boot values. */
async function flashSave(b, link, inputName) {
    const set = (await link.request('GetInputSettings', { inputName })).inputSettings || {};
    const amp = await procAmp(link, inputName);
    const rates = await listOpts(link, inputName, 'frame_interval');
    const fr = rates.find((o) => String(o.value) === String(set.frame_interval));
    const cams = flashFor(b.id);
    cams[inputName] = { at: Date.now(), res_type: set.res_type, resolution: set.resolution || '', frame_interval: set.frame_interval, fpsText: fr ? fr.text : '', amp };
    flashWrite(b.id, cams);
}

/** Apply a camera's boot values (format on the device, proc amp in the mixer). */
async function flashApply(link, inputName, v) {
    const format = {};
    if (Number(v.res_type) === 1) { format.res_type = 1; if (v.resolution) format.resolution = v.resolution; if (v.frame_interval != null) format.frame_interval = v.frame_interval; }
    if (Object.keys(format).length) await link.request('SetInputSettings', { inputName, inputSettings: format, overlay: true });
    if (v.amp) await setProcAmp(link, inputName, v.amp);
}

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

// ------------------------------------------------------------------ live cards (replace the unit's image cards)

const CARD_INPUT = 'AV Live Card';

/**
 * Put the live cards where the units show their image cards:
 *   mux unit: scene "SysTest" (the system test card) gets a full-frame "AV Live Card" browser source on top
 *   satellite: every group holding the standby slate image behind a cabinet's NDI feed gets an
 *              "AV Live Slate <cabinet>" just above that image (the feed still covers it when it arrives)
 * The image cards stay underneath, untouched. Returns how many places got a card.
 */
async function installCards(b, link) {
    const base = overlayUrl(b);
    const v = await link.request('GetVideoSettings');
    const size = { width: v.baseWidth || 1920, height: v.baseHeight || 1080 };
    const css = 'html, body { background: transparent !important; margin: 0; overflow: hidden; }';
    const scenes = ((await link.request('GetSceneList')).scenes || []).map((x) => x.sceneName);
    let n = 0;
    const put = async (sceneName, inputName, url, aboveIndex) => {
        let exists = true;
        try { await link.request('GetInputSettings', { inputName }); } catch (_) { exists = false; }
        const settings = { url, ...size, css, shutdown: false, restart_when_active: false, reroute_audio: false };
        let id;
        if (!exists) id = (await link.request('CreateInput', { sceneName, inputName, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true })).sceneItemId;
        else {
            await link.request('SetInputSettings', { inputName, inputSettings: settings, overlay: true });
            const items = (await link.request(scenes.includes(sceneName) ? 'GetSceneItemList' : 'GetGroupSceneItemList', { sceneName })).sceneItems || [];
            const it = items.find((i) => i.sourceName === inputName);
            id = it ? it.sceneItemId : (await link.request('CreateSceneItem', { sceneName, sourceName: inputName, sceneItemEnabled: true })).sceneItemId;
        }
        if (aboveIndex != null) await link.request('SetSceneItemIndex', { sceneName, sceneItemId: id, sceneItemIndex: aboveIndex + 1 }).catch(() => {});
        n++;
    };
    if (b.kind === 'cabinet') {
        const sys = scenes.find((x) => /^sys ?test$/i.test(x));
        if (sys) {
            const items = (await link.request('GetSceneItemList', { sceneName: sys })).sceneItems || [];
            await put(sys, CARD_INPUT, `${base}&card=systest`, items.length - 1);
        }
    } else {
        for (const c of deps.readConfig().cabinets) {
            const sceneItems = (await link.request('GetSceneItemList', { sceneName: c.scene }).catch(() => ({}))).sceneItems || [];
            for (const g of sceneItems.filter((i) => i.isGroup)) {
                const gi = (await link.request('GetGroupSceneItemList', { sceneName: g.sourceName }).catch(() => ({}))).sceneItems || [];
                const slate = gi.find((i) => i.inputKind === 'image_source' && /boot|wait|slate|standby/i.test(i.sourceName));
                const ndi = gi.find((i) => i.inputKind === 'ndi_source');
                if (!slate || !ndi) continue;
                await put(g.sourceName, `AV Live Slate ${c.short || c.id}`, `${base}&card=slate&cab=${encodeURIComponent(c.id)}`, slate.sceneItemIndex);
            }
        }
    }
    return n;
}

/** The data a live card draws, refreshed while a card page is subscribed. */
async function cardData(b, card, cabId) {
    const u = deps.unitInfo(boxName(b), b.kind === 'satellite' ? 'satellite' : 'mux');
    const out = { card, unit: { name: boxName(b), maker: u.maker, line: u.line, model: u.model, type: u.kind, theme: u.theme, sw: u.sw || '', hw: u.hw || '', fw: u.fw || '' }, at: Date.now() };
    if (card === 'slate') {
        const d = deps.diag.lastFor(cabId);
        const rx = d && d.output && d.output.stages.find((x) => x.id === 'rx');
        const src = d && d.input && d.input.source;
        out.feed = src || '';
        out.ok = !!(rx && rx.state === 'ok');
        out.status = out.ok ? `Receiving ${src || 'downstream device'}` : `Connecting to downstream device${src ? ` ${src}` : ''}...`;
        return out;
    }
    // systest: the unit's video inputs as hardware I/O tiles, with their signal
    const { link } = await linkOf(b);
    const [ins, v, sc] = await Promise.all([videoInputs(link), link.request('GetVideoSettings'), link.request('GetSceneList')]);
    const sizes = new Map();
    for (const s of (sc.scenes || []).slice(0, 24)) {
        const items = (await link.request('GetSceneItemList', { sceneName: s.sceneName }).catch(() => ({}))).sceneItems || [];
        for (const it of items) { const t = it.sceneItemTransform || {}; if (t.sourceWidth && !sizes.has(it.sourceName)) sizes.set(it.sourceName, `${t.sourceWidth}x${t.sourceHeight}`); }
    }
    const hw = ins.filter((i) => PORTS[i.inputKind] && i.inputKind !== 'ndi_source').slice(0, 8);
    out.tiles = hw.map((i, n) => ({ n: n + 1, name: i.inputName, type: PORTS[i.inputKind].type, size: sizes.get(i.inputName) || '', ok: sizes.has(i.inputName) }));
    const dead = out.tiles.filter((t) => !t.ok);
    out.status = !out.tiles.length ? 'PREPARING HARDWARE I/O' : dead.length ? `INPUT ${dead[0].n} NO SIGNAL${dead.length > 1 ? ` (+${dead.length - 1})` : ''}` : 'HARDWARE I/O READY';
    out.ok = out.tiles.length > 0 && !dead.length;
    out.format = `${v.outputWidth}x${v.outputHeight}p${fpsText(v.fpsNumerator, v.fpsDenominator)}`;
    return out;
}

function subscribeCard(boxId, k, card, cabId, res) {
    if (!validId(boxId) || !checkToken(boxId, k) || !['systest', 'slate'].includes(card)) return false;
    const b = box(boxId);
    if (!b.cardSubs) b.cardSubs = new Map();
    b.cardSubs.set(res, { card, cab: String(cabId || '') });
    return () => b.cardSubs.delete(res);
}

setInterval(() => {
    for (const b of boxes.values()) {
        if (!b.cardSubs || !b.cardSubs.size || b.cardBusy) continue;
        b.cardBusy = true;
        (async () => {
            for (const [res, sub] of b.cardSubs) {
                let data;
                try { data = await cardData(b, sub.card, sub.cab); } catch (e) { data = { card: sub.card, error: e.message }; }
                try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) { b.cardSubs.delete(res); }
            }
        })().catch(() => {}).finally(() => { b.cardBusy = false; });
    }
}, 2000).unref();

// ------------------------------------------------------------------ power on: boot screen + self test

const AUDIO_KINDS = new Set(['wasapi_input_capture', 'wasapi_output_capture', 'wasapi_process_output_capture', 'dshow_input']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Power on / reset of a unit: its boot screen, then the power-on self test, drawn full-frame on its
 * own output (the OSD layer). Checks, per source:
 *   PRESENT  the device / port it is assigned is still listed by the unit (a missing USB camera, audio
 *            interface or NDI feed fails here)
 *   LOCK     video inputs carry a picture (a capture with no signal, e.g. HDMI desktop capture not
 *            locking, reports 0x0)
 *   RATE     cameras / captures run near their set rate on the unit's own clock (unstable or low)
 * Any alarm holds the self-test screen for osd.alarmHoldS seconds (default 10, counting down) before
 * the unit goes to program, so whoever is watching the output sees it.
 */
async function powerOn(boxId, opts = {}) {
    const b = boxes.get(boxId) || box(boxId);
    if (b.post) return b.lastPost;
    if (b.kind === 'satellite' && await deps.onAir(b).catch(() => false)) return null; // never over a live broadcast
    const cfg = deps.readConfig().osd || {};
    const holdS = Math.max(0, Math.min(120, Number(cfg.alarmHoldS) || 10));
    b.post = { phase: 'boot', text: b.kind === 'satellite' ? 'Starting...' : 'SYSTEM START', reason: opts.reason || 'power', items: [], alarms: 0 };
    emit(b);
    try { await placeOverlay(b); } catch (_) { /* unit still coming up */ }
    emit(b);
    await sleep(3000);
    let link;
    try { ({ link } = await linkOf(b)); } catch (e) { b.post = null; return null; }
    // boot values from flash: each saved camera's format and proc amp
    const cams = flashFor(b.id);
    if (Object.keys(cams).length) {
        b.post.text = 'LOADING CAMERA SETTINGS';
        emit(b);
        for (const [name, v] of Object.entries(cams)) { try { await flashApply(link, name, v); } catch (_) { /* a missing camera is the self test's to report */ } }
    }
    b.post.phase = 'test';
    b.post.text = 'POWER ON SELF TEST';
    emit(b);
    const items = [];
    const add = (it) => { items.push(it); b.post.items = items.slice(0, 8); emit(b); };
    try {
        const list = ((await link.request('GetInputList')).inputs || []).filter((i) => i.inputName !== OVERLAY_INPUT && !/^AV Live/.test(i.inputName));
        const v = await link.request('GetVideoSettings');
        const unitFps = v.fpsDenominator ? v.fpsNumerator / v.fpsDenominator : 30;
        // where each input is enabled (scenes, groups) and its size there (a capture with no signal is 0x0)
        const sizes = new Map();
        const usedIn = new Map(); // input -> Set of top-level scenes
        const sc = ((await link.request('GetSceneList')).scenes || []).filter((x) => x.sceneName !== OVERLAY_SCENE);
        const walk = async (top, name, group, depth) => {
            if (depth > 4) return;
            const its = (await link.request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName: name }).catch(() => ({}))).sceneItems || [];
            for (const it of its) {
                if (!it.sceneItemEnabled) continue;
                if (it.isGroup) { await walk(top, it.sourceName, true, depth + 1); continue; }
                if (!usedIn.has(it.sourceName)) usedIn.set(it.sourceName, new Set());
                usedIn.get(it.sourceName).add(top);
                const t = it.sceneItemTransform || {};
                if (t.sourceWidth) sizes.set(it.sourceName, t.sourceWidth);
            }
        };
        for (const x of sc.slice(0, 24)) await walk(x.sceneName, x.sceneName, false, 0);
        // on the satellite, an input belongs to the cabinets whose layouts use it (a dead feed only
        // locks those cabinets); global audio devices belong to all
        const cabScenes = deps.readConfig().cabinets.map((c) => ({ id: c.id, scene: c.scene }));
        const specials = new Set();
        try { const sp = await link.request('GetSpecialInputs'); Object.values(sp || {}).forEach((x) => { if (x) specials.add(x); }); } catch (_) { /* older engine */ }
        let n = 0;
        for (const inp of list) {
            const port = PORTS[inp.inputKind];
            const video = VIDEO_KINDS.has(inp.inputKind) && inp.inputKind !== 'ffmpeg_source' && inp.inputKind !== 'window_capture' && inp.inputKind !== 'game_capture';
            const audio = AUDIO_KINDS.has(inp.inputKind) && !video;
            if (!port && !video) continue;
            if (!usedIn.has(inp.inputName) && !specials.has(inp.inputName)) continue; // not wired to anything
            n++;
            const it = { n, label: inp.inputName, type: port ? port.type : 'VIDEO', state: 'ok', detail: 'OK' };
            if (b.kind === 'satellite' && !specials.has(inp.inputName)) it.cabs = cabScenes.filter((c) => usedIn.get(inp.inputName).has(c.scene)).map((c) => c.id);
            if (port) {
                const opts2 = await portOptions(link, inp);
                const cur = ((await link.request('GetInputSettings', { inputName: inp.inputName }).catch(() => ({}))).inputSettings || {})[port.prop];
                if (opts2.length && cur && !opts2.some((o) => o.value === cur)) { it.state = 'alarm'; it.detail = audio ? 'AUDIO DEVICE MISSING' : 'DEVICE MISSING'; }
            }
            // LOCK only for inputs that are active: a capture not in the current layout idles (0x0) by design
            let active = true;
            if (video) { try { active = !!(await link.request('GetSourceActive', { sourceName: inp.inputName })).videoActive; } catch (_) { active = true; } }
            if (it.state === 'ok' && video && !active) it.detail = 'STANDBY';
            else if (it.state === 'ok' && video && !sizes.has(inp.inputName)) { it.state = 'alarm'; it.detail = 'NO SIGNAL LOCK'; }
            if (it.state === 'ok' && video && active && CAMERA_KINDS.has(inp.inputKind) && sizes.has(inp.inputName)) {
                // frame rate on the unit's clock, about 1 s of frames
                const frames = Math.round(unitFps);
                const reqs = [];
                for (let i = 0; i < frames; i++) reqs.push({ requestType: 'GetSourceScreenshot', requestData: { sourceName: inp.inputName, imageFormat: 'jpg', imageWidth: 32, imageHeight: 18, imageCompressionQuality: 80 } }, { requestType: 'Sleep', requestData: { sleepFrames: 1 } });
                try {
                    const res = await link.batch(reqs, { executionType: 2, timeoutMs: 15000 });
                    const shots = res.filter((r) => r.requestType === 'GetSourceScreenshot' && r.requestStatus && r.requestStatus.result).map((r) => r.responseData.imageData);
                    let ch = 0;
                    for (let i = 1; i < shots.length; i++) if (shots[i] !== shots[i - 1]) ch++;
                    const got = shots.length > 5 ? Math.round((ch / (shots.length - 1)) * unitFps) : null;
                    const set = ((await link.request('GetInputSettings', { inputName: inp.inputName }).catch(() => ({}))).inputSettings || {});
                    const want = Number(set.res_type) === 1 && Number(set.frame_interval) > 0 ? Math.min(unitFps, 1e7 / Number(set.frame_interval)) : unitFps;
                    if (got != null && ch >= 3 && got < want * 0.8) { it.state = 'alarm'; it.detail = `RATE ${got}/${Math.round(want)} FPS`; } else if (ch < 3) it.detail = 'OK (NO MOTION)';
                    else it.detail = `OK ${got} FPS`;
                } catch (_) { it.detail = 'OK (RATE NOT MEASURED)'; }
            }
            add(it);
        }
    } catch (e) { add({ n: 0, label: 'SELF TEST', type: '', state: 'alarm', detail: e.message.slice(0, 60) }); }
    const alarms = items.filter((x) => x.state === 'alarm');
    b.post.items = (alarms.length ? [...alarms, ...items.filter((x) => x.state !== 'alarm')] : items).slice(0, 8);
    b.post.alarms = alarms.length;
    b.lastPost = { at: Date.now(), alarms: alarms.length, items };
    if (alarms.length) {
        // a failed self test latches a FAULT (front panel ALARM, the FAULT menu page) until a technician clears it
        b.fault = { at: Date.now(), items: alarms.map((x) => ({ label: x.label, type: x.type, detail: x.detail, cabs: x.cabs || null })), overridden: false, reason: b.post.reason };
        b.post.phase = 'fault';
        b.post.text = `FAULT: ${alarms[0].label} ${alarms[0].detail}${alarms.length > 1 ? ` (+${alarms.length - 1})` : ''}`;
        // advisory: the card holds for osd.alarmHoldS (counting down) and hands back to program; the fault
        // stays latched on the front panel ALARM led and the unit's FAULT menu page
        b.post.holdUntil = Date.now() + holdS * 1000;
        saveFault(b);
        while (b.post && Date.now() < b.post.holdUntil) { emit(b); await sleep(1000); }
        b.post = null;
        emit(b);
        return b.lastPost;
    }
    b.fault = null;
    saveFault(b);
    b.post.phase = 'pass';
    b.post.text = 'SELF TEST PASSED';
    emit(b);
    await sleep(Math.max(2000, holdS * 0));
    b.post = null;
    try { await placeOverlay(b); } catch (_) { /* gone */ }
    emit(b);
    return b.lastPost;
}

// ------------------------------------------------------------------ view + keys

function frame(b) { return b.stack[b.stack.length - 1]; }

/** Pages whose numbers move on their own and are re-read while shown. */
const LIVE_PAGES = new Set(['clock', 'diag', 'system', 'audio', 'align', 'fpsm', 'alarms', 'xlink']);

/** Read the top page from the box (OBS round trips) into its frame's cache. */
async function buildPage(b) {
    const f = frame(b);
    if (!f) return;
    let link;
    let target;
    try { ({ link, target } = await linkOf(b)); b.offline = ''; } catch (e) { b.offline = e.message; return; }
    try {
        const page = await PAGES[f.page](b, link, f, target);
        if (frame(b) !== f) return; // the operator moved on meanwhile
        f.cache = page;
        f.rows = page.rows;
        f.error = '';
        f.at = Date.now();
    } catch (e) { f.error = e.message; }
}

async function buildStrip(b) {
    try {
        const { link, target } = await linkOf(b);
        const [v, st, pg] = await Promise.all([link.request('GetVideoSettings'), link.request('GetStats'), link.request('GetCurrentProgramScene')]);
        b.strip = { unit: boxName(b), format: `${v.outputHeight}p${fpsText(v.fpsNumerator, v.fpsDenominator)}`, fps: round1(st.activeFps || 0), cpu: round1(st.cpuUsage || 0), frame: round1(st.averageFrameRenderTime || 0), program: pg.currentProgramSceneName, addr: target ? target.host : '' };
    } catch (_) { b.strip = null; }
}

/** Build the view from what is cached (no OBS round trip) and push it to the box's OSD page. */
function emit(b) {
    const u = deps.unitInfo(boxName(b), b.kind === 'satellite' ? 'satellite' : 'mux');
    const out = { toastHead: Date.now() - b.toastAt < 4000 ? b.toastHead || '' : '', toastSub: Date.now() - b.toastAt < 4000 ? b.toastSub || '' : '', box: { id: b.id, name: boxName(b), kind: b.kind, maker: u.maker, line: u.line, model: u.model, type: u.kind, theme: u.theme, sw: u.sw, hw: u.hw, fw: u.fw }, ui: u.theme, open: b.open, info: b.info, toast: Date.now() - b.toastAt < 4000 ? b.toast : '', rev: ++b.rev, at: Date.now() };
    if (b.offline) out.offline = b.offline;
    const f = b.open ? frame(b) : null;
    if (f) {
        const page = f.cache;
        if (!page) out.page = { id: f.page, title: f.title || f.page.toUpperCase(), crumbs: b.stack.map((x) => x.page), rows: [], loading: true, cursor: 0, first: 0, total: 0, hint: 'Reading...' };
        else {
            const rows = page.rows || [];
            f.cursor = Math.max(0, Math.min(f.cursor || 0, rows.length - 1));
            while (rows[f.cursor] && rows[f.cursor].kind === 'head' && f.cursor < rows.length - 1) f.cursor++; // never rest on a heading
            const first = Math.max(0, Math.min(f.cursor - Math.floor(PAGE_ROWS / 2), rows.length - PAGE_ROWS));
            out.page = { id: f.page, title: page.title, crumbs: b.stack.map((x) => x.page), hint: (rows[f.cursor] && rows[f.cursor].hint) || page.hint || '', cursor: f.cursor, first, total: rows.length, rows: rows.slice(first, first + PAGE_ROWS) };
            if (f.error) out.page.error = f.error;
        }
    }
    // the STATUS box: while INFO is on, or for a few seconds after a scene switch
    if ((b.info || Date.now() < (b.infoFlashUntil || 0)) && b.strip) out.strip = b.strip;
    if (b.post) out.post = { ...b.post, holdLeft: b.post.holdUntil ? Math.max(0, Math.ceil((b.post.holdUntil - Date.now()) / 1000)) : 0 };
    b.view = out;
    for (const res of b.subs) { try { res.write(`data: ${JSON.stringify(out)}\n\n`); } catch (_) { b.subs.delete(res); } }
    return out;
}

/** Full refresh: page and strip from the box, then emit. */
async function render(b) {
    if (b.open) await buildPage(b);
    if (b.info) await buildStrip(b);
    return emit(b);
}

function toast(b, text, head, sub) { b.toast = text; b.toastHead = head || ''; b.toastSub = sub || ''; b.toastAt = Date.now(); }

/**
 * The unit's own screenshot notice, drawn as a hardware OSD box: when its "SysInfo-Screenshot" overlay
 * (an image group) is switched on, it is switched straight off again and the OSD shows the notice;
 * the engine's ScreenshotSaved event shows it too (with the file name).
 */
const SHOT_RE = /screen ?shot|^sysinfo-ss/i;
const INFO_FLASH_MS = 5000;
function hookUnit(b, link) {
    if (link._avosdHooked) return;
    link._avosdHooked = true;
    link.listeners.add((type, data) => {
        if (type === 'CurrentProgramSceneChanged') {
            // like a hardware mixer showing its status on a take: the layer follows the new program, then
            // the STATUS box shows for INFO_FLASH_MS
            void (async () => {
                await placeOverlay(b).catch(() => {});
                await buildStrip(b);
                b.infoFlashUntil = Date.now() + INFO_FLASH_MS;
                emit(b);
                setTimeout(() => emit(b), INFO_FLASH_MS + 50);
            })().catch(() => {});
            return;
        }
        if (type === 'ScreenshotSaved') {
            const file = String(data.savedScreenshotPath || '').split(/[\\/]/).pop();
            toast(b, 'IMAGE SAVED TO DISK', 'SCREENSHOT', file);
            void placeOverlay(b).catch(() => {}).then(() => emit(b));
            return;
        }
        if (type !== 'SceneItemEnableStateChanged' || !data.sceneItemEnabled) return;
        void (async () => {
            const items = (await link.request('GetSceneItemList', { sceneName: data.sceneName }).catch(() => link.request('GetGroupSceneItemList', { sceneName: data.sceneName })).catch(() => ({}))).sceneItems || [];
            const it = items.find((x) => x.sceneItemId === data.sceneItemId);
            if (!it || !SHOT_RE.test(it.sourceName)) return;
            await link.request('SetSceneItemEnabled', { sceneName: data.sceneName, sceneItemId: data.sceneItemId, sceneItemEnabled: false }).catch(() => {});
            toast(b, 'IMAGE SAVED TO DISK', 'SCREENSHOT', '');
            emit(b);
        })().catch(() => {});
    });
}

async function onKey(b, key) {
    const { link } = await linkOf(b);
    if (key === 'menu') {
        if (b.open) { b.open = false; b.stack = []; b.pending.clear(); } else { b.open = true; b.stack = [{ page: 'main', cursor: 0 }]; /* always MAIN: ALARMS is its first item */ }
        return;
    }
    if (key === 'info') { b.info = !b.info; return; }
    if (key === 'xlink') {
        const top = b.open ? frame(b) : null;
        if (top && top.page === 'xlink') { b.open = false; b.stack = []; b.pending.clear(); return; }
        b.open = true;
        b.stack = [{ page: 'xlink', path: [], cursor: 0, title: 'XLINK' }];
        return;
    }
    if (key === 'diag') { if (!b.open) b.open = true; b.stack = [{ page: 'main', cursor: 7 }, { page: 'diag', cursor: 0 }]; return; }
    if (!b.open) { if (key === 'exit' && b.info) b.info = false; return; }
    const f = frame(b);
    if (key === 'exit') {
        b.pending.clear();
        b.stack.pop();
        if (!b.stack.length) b.open = false;
        return;
    }
    if (!f.cache) await buildPage(b);
    const rows = f.rows || [];
    const row = rows[f.cursor || 0];
    if (key === 'up') { f.cursor = (f.cursor + rows.length - 1) % Math.max(1, rows.length); return; }
    if (key === 'down') { f.cursor = (f.cursor + 1) % Math.max(1, rows.length); return; }
    if (!row) return;
    const name = row.id.slice(row.id.indexOf(':') + 1);
    const dir = key === 'left' ? -1 : key === 'right' ? 1 : 0;
    if (row.xl) {
        const path = row.id.slice(3).split('.').map(Number);
        if (row.xl === 'folder' && (key === 'ok' || key === 'right')) { b.stack.push({ page: 'xlink', path, cursor: 0, title: row.label }); return; }
        const menu = await xlinkMenu(b);
        let n = { children: menu.items };
        for (const i of path) n = (n.children || [])[i];
        if (!n) return;
        if (row.xl === 'toggle') {
            const act = Math.max(0, n.toggle.findIndex((o) => o.active));
            const cur = b.pending.has(row.id) ? b.pending.get(row.id) : act;
            if (dir) { b.pending.set(row.id, (cur + dir + n.toggle.length) % n.toggle.length); b.xlConfirm = null; return; }
            if (key === 'ok') {
                await xlinkRun(b, path, 'toggle', cur, `${n.text} ${n.toggle[cur].label || ''}`.trim());
                if (!b.xlConfirm) b.pending.delete(row.id);
            }
            return;
        }
        if (row.xl === 'button' && key === 'ok') {
            let anc = '';
            { let l = menu.items; for (const i of path.slice(0, -1)) { anc += `${l[i].text} `; l = l[i].children || []; } }
            await xlinkRun(b, path, 'send', undefined, `${anc}${n.text}`.trim());
        }
        return;
    }
    if (row.kind === 'nav' && key === 'ok') {
        if (row.id.startsWith('cam:')) { b.stack.push({ page: 'cam', arg: row.id.slice(4), cursor: 0, title: row.label }); return; }
        b.stack.push({ page: row.id, cursor: 0, title: row.label });
        return;
    }
    if (row.id.startsWith('amp:')) {
        const [, k, ...rest] = row.id.split(':');
        const inputName = rest.join(':');
        if (k === 'reset') { if (key === 'ok') { await setProcAmp(link, inputName, { brightness: 0, contrast: 0, gamma: 0, saturation: 0, hue_shift: 0 }); toast(b, `${inputName}: proc amp at unity`); } return; }
        if (!dir) return;
        const amp = await procAmp(link, inputName);
        const [step, lo, hi] = AMP_STEP[k];
        amp[k] = Math.round(Math.max(lo, Math.min(hi, amp[k] + dir * step)) * 1000) / 1000;
        await setProcAmp(link, inputName, amp);
        return;
    }
    if (row.id.startsWith('csave:') && key === 'ok') {
        const inputName = row.id.slice(6);
        await flashSave(b, link, inputName);
        toast(b, `${inputName}: saved to flash (boot values)`);
        return;
    }
    if (row.id.startsWith('cboot:')) {
        const inputName = row.id.slice(6);
        const cams = flashFor(b.id);
        if (!cams[inputName]) return;
        if (key === 'left') { delete cams[inputName]; flashWrite(b.id, cams); toast(b, `${inputName}: boot values cleared`); return; }
        if (key === 'ok') { await flashApply(link, inputName, cams[inputName]); toast(b, `${inputName}: boot values loaded`); }
        return;
    }
    if (row.id.startsWith('cres:') || row.id.startsWith('cfps:')) {
        const isRes = row.id.startsWith('cres:');
        const inputName = row.id.slice(5);
        const prop = isRes ? 'resolution' : 'frame_interval';
        const pk = `${isRes ? 'res' : 'fi'}:${inputName}`;
        const opts = await listOpts(link, inputName, prop);
        const set = (await link.request('GetInputSettings', { inputName })).inputSettings || {};
        if (dir && opts.length) {
            const cur = b.pending.has(pk) ? b.pending.get(pk) : set[prop];
            const i = opts.findIndex((o) => String(o.value) === String(cur));
            b.pending.set(pk, opts[(i + dir + opts.length) % opts.length].value);
        } else if (key === 'ok' && b.pending.has(pk)) {
            const v = b.pending.get(pk);
            b.pending.delete(pk);
            // custom format (res_type 1) so the chosen resolution / rate is what the camera runs
            await link.request('SetInputSettings', { inputName, inputSettings: { res_type: 1, [prop]: v }, overlay: true });
            toast(b, `${inputName}: ${isRes ? v : (opts.find((o) => String(o.value) === String(v)) || {}).text || v}`);
        }
        return;
    }
    if (/^f:\d+$/.test(row.id) && key === 'ok' && b.fault) {
        const it = b.fault.items[Number(row.id.slice(2))];
        if (!it) return;
        if (it.bypass) {
            for (const x of it.bypass) await link.request('SetSceneItemEnabled', { sceneName: x.scene, sceneItemId: x.id, sceneItemEnabled: true }).catch(() => {});
            toast(b, `${it.label}: back in ${it.bypass.length} scene${it.bypass.length === 1 ? '' : 's'}`);
            delete it.bypass;
        } else {
            it.bypass = await bypassInput(link, it.label);
            toast(b, it.bypass.length ? `${it.label}: bypassed in ${it.bypass.length} scene${it.bypass.length === 1 ? '' : 's'}` : `${it.label}: not on any scene`);
        }
        saveFault(b);
        return;
    }
    if (row.id === 'f:retest' && key === 'ok') { b.open = false; b.stack = []; void powerOn(b.id, { reason: 'retest' }); return; }
    if (row.id === 'f:override' && key === 'ok' && b.fault) {
        b.fault.overridden = !b.fault.overridden;
        saveFault(b);
        if (b.fault.overridden && b.post) b.post = null;
        toast(b, b.fault.overridden ? 'FAULT OVERRIDDEN: airing with a known fault' : 'Fault lock restored');
        return;
    }
    if (row.id === 's:post' && key === 'ok') { b.open = false; b.stack = []; b.pending.clear(); void powerOn(b.id, { reason: 'manual' }); return; }
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
    if (row.id === 's:card' && key === 'ok') {
        const n = await installCards(b, link);
        b.cardInstalled = n > 0;
        toast(b, n ? `Live card installed in ${n} place${n === 1 ? '' : 's'}` : 'Nowhere to install: no SysTest scene / standby slate found');
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
                toast(b, `${fpsText(n, d)} fps stored: takes effect when the engine restarts (outputs active)`);
            }
        }
    }
}

const KEYS = new Set(['up', 'down', 'left', 'right', 'ok', 'menu', 'diag', 'info', 'exit', 'xlink']);

const NAV_ONLY = new Set(['up', 'down']);

/**
 * A remote key press for a box. Keys are queued per box and run in order; a full queue drops the press
 * (a held key never replays for seconds after release). Up / down move on the cached page with no OBS
 * round trip; the OSD layer is only placed when the menu or strip opens or closes.
 */
async function press(target, cabinetId, key) {
    if (!KEYS.has(key)) throw fail('Unknown key', 'AVOSD_KEY');
    const b = await resolveBox(target, cabinetId);
    if (!b.settled) await settle(b);
    if (!b.queue) b.queue = [];
    if (b.queue.length >= 2) return b.view || emit(b);
    return new Promise((resolve) => {
        b.queue.push({ key, resolve });
        if (!b.worker) b.worker = drain(b).finally(() => { b.worker = null; });
    });
}

async function drain(b) {
    while (b.queue.length) {
        const { key, resolve } = b.queue.shift();
        b.busy = true;
        try {
            const f = b.open ? frame(b) : null;
            if (NAV_ONLY.has(key) && f && f.cache) {
                const n = Math.max(1, (f.rows || []).length);
                for (let i = 0; i < n; i++) {
                    f.cursor = key === 'up' ? (f.cursor + n - 1) % n : (f.cursor + 1) % n;
                    if (!f.rows[f.cursor] || f.rows[f.cursor].kind !== 'head') break; // section headings are not selectable
                }
                resolve(emit(b));
                continue;
            }
            const wasUp = b.open || b.info;
            const depth = b.stack.length;
            try { await onKey(b, key); } catch (e) { toast(b, `ERROR: ${e.message}`); }
            const up = b.open || b.info;
            // show the change on the unit at once (a new page shows its title while it reads), read the
            // page, answer the remote, and only then place / remove the OSD layer (the slow part)
            emit(b);
            const top = b.open ? frame(b) : null;
            const needPage = top && (!top.cache || b.stack.length !== depth || !NAV_ONLY.has(key));
            if (needPage && !(key === 'exit' && top.cache)) await buildPage(b);
            if (b.info && !b.strip) await buildStrip(b);
            resolve(emit(b));
            if (up !== wasUp) { try { await placeOverlay(b); } catch (e) { toast(b, `OSD layer: ${e.message}`); } emit(b); }
        } finally { b.busy = false; }
    }
}

/** The current view (QuickCast polls it for the remote's LCD line). */
async function view(target, cabinetId) {
    const b = await resolveBox(target, cabinetId);
    return b.view || emit(b); // emit builds the full unit identity (maker, model, theme) for the panel
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
// keep the resident OSD layer on each known unit's current program (the program can change under it)
setInterval(() => {
    for (const b of boxes.values()) {
        if (b.busy || b.placing || !b.settled) continue;
        b.placing = true;
        placeOverlay(b).catch(() => {}).finally(() => { b.placing = false; });
    }
}, 10000).unref();

// keep an open OSD's moving numbers fresh (clock, diagnostics, levels), and the layer on the program
// scene if the box's program changed under it; never while keys are being worked
let tick = 0;
setInterval(() => {
    tick++;
    for (const b of boxes.values()) {
        if (!(b.open || b.info) || b.busy || b.refreshing || (b.queue && b.queue.length)) continue;
        const f = b.open ? frame(b) : null;
        const live = f && LIVE_PAGES.has(f.page);
        if (!live && !b.info && tick % 3) continue;
        b.refreshing = true;
        (async () => {
            if (live) await buildPage(b);
            if (b.info) await buildStrip(b);
            if (tick % 3 === 0) await placeOverlay(b).catch(() => {});
            emit(b);
        })().catch(() => {}).finally(() => { b.refreshing = false; });
    }
}, 2000).unref();

/** Latched self-test faults: [{ unit, box, kind, at, items, overridden }] (VisionCaster locks LIVE on them). */
function faults() {
    const out = [];
    for (const id of Object.keys(loadFaults())) if (validId(id)) box(id);
    for (const b of boxes.values()) {
        if (!b.fault) continue;
        const items = b.fault.items.filter((i) => !i.bypass); // a bypassed input is not an active alarm
        if (items.length) out.push({ unit: boxName(b), box: b.id, kind: b.kind, machine: b.machine, at: b.fault.at, items, overridden: !!b.fault.overridden });
    }
    return out;
}

/** The last AUTO ALIGN result on a mux unit (for VisionCaster's timing bars), or null. */
function alignFor(machine) {
    const b = boxes.get(`mux-${machine}`);
    if (!b || !b.align) return null;
    const sel = b.alignSel || {};
    const r = b.align.result;
    return { cam: sel.cam || '', ref: sel.ref || '', running: !!b.align.running, offMs: r && r.offMs != null ? r.offMs : null, score: r ? r.score : null, text: r ? r.text : b.align.error || '' };
}

module.exports = { faults, powerOn, subscribeCard, alignFor, init, press, view, subscribe, checkToken, PORTS, bestLag, _boxes: boxes, OVERLAY_SCENE, OVERLAY_INPUT, DELAY_FILTER };
