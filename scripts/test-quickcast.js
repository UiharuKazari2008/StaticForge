#!/usr/bin/env node
// QuickCast (Yozora #734; modules/quickcast.js, apps/quickcast): the obs-websocket client against a fake
// OBS on loopback. Never points at the real OBS (it would go live). Run: node scripts/test-quickcast.js
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickcast-test-'));
process.env.QUICKCAST_DATA_DIR = dir;
process.env.QUICKCAST_DEVICE_MIN_S = '0.05';
// a fake XLink menu.json + cabinet on loopback: never the real cabinets
const xdir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickcast-xlink-'));
process.env.XLINK_DATA_DIR = xdir;
const cab = { power: 'Active', game: 'Verse', hits: [] };
process.env.QUICKCAST_CHAT_MIN_MS = '50';
const http = require('http');

// fake Google OAuth + YouTube Data API
const g = { polls: 0, broadcasts: [], bound: [], videos: [], sent: [], transitions: [] };
const google = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
        const u = new URL(req.url, 'http://x');
        const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        const form = new URLSearchParams(raw);
        const authed = req.headers.authorization === 'Bearer at-1';
        if (u.pathname === '/device/code') return send(200, { device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 0.05 });
        if (u.pathname === '/token') {
            if (form.get('grant_type') === 'refresh_token') return send(200, { access_token: 'at-1', expires_in: 3600 });
            if (++g.polls < 2) return send(428, { error: 'authorization_pending' });
            return send(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 });
        }
        const yt = u.pathname.replace(/^\/yt/, '');
        if (!authed && !(u.searchParams.get('key') === 'AIzaFakeKeyFakeKeyFakeKey123')) return send(401, { error: { message: 'no auth', errors: [{ reason: 'authError' }] } });
        if (yt === '/channels') return send(200, { items: [{ id: 'UCfakechannelfakechannel', snippet: { title: 'Kamisato Tadashi', customUrl: '@rhythmgamer', thumbnails: { default: { url: 'https://yt3.example/a.jpg' } } }, statistics: { subscriberCount: '425', videoCount: '28' } }] });
        if (yt === '/liveStreams') return send(200, { items: [{ id: 'stream-9', cdn: { ingestionInfo: { streamName: 'abcd-efgh-ijkl-mnop-qrst' } } }] });
        if (yt === '/liveBroadcasts' && req.method === 'POST') { const b = JSON.parse(raw); g.broadcasts.push(b); return send(200, { id: 'vid-1', snippet: { ...b.snippet, liveChatId: 'chat-1' } }); }
        if (yt === '/liveBroadcasts/bind') { g.bound.push([u.searchParams.get('id'), u.searchParams.get('streamId')]); return send(200, {}); }
        if (yt === '/liveBroadcasts/transition') { g.transitions.push(u.searchParams.get('broadcastStatus')); return send(200, {}); }
        if (yt === '/videos' && req.method === 'PUT') { g.videos.push(JSON.parse(raw)); return send(200, {}); }
        if (yt === '/liveChat/messages' && req.method === 'GET') {
            const page = u.searchParams.get('pageToken');
            const items = page ? [] : [
                { id: 'm1', snippet: { type: 'textMessageEvent', publishedAt: new Date().toISOString(), displayMessage: 'hello <b>' }, authorDetails: { displayName: 'viewer', isChatModerator: true } },
                { id: 'm2', snippet: { type: 'superChatEvent', publishedAt: new Date().toISOString(), displayMessage: 'gg', superChatDetails: { amountDisplayString: '\u00a5500' } }, authorDetails: { displayName: 'fan' } }
            ];
            return send(200, { items, nextPageToken: 'p2', pollingIntervalMillis: 60 });
        }
        if (yt === '/liveChat/messages' && req.method === 'POST') { const b = JSON.parse(raw); g.sent.push(b.snippet.textMessageDetails.messageText); return send(200, { id: 'm3', snippet: { type: 'textMessageEvent', publishedAt: new Date().toISOString(), displayMessage: b.snippet.textMessageDetails.messageText } }); }
        return send(404, { error: { message: `fake: ${req.method} ${yt}` } });
    });
});
const PASSWORD = 'fake-ws-pass';

const obs = {
    collection: 'Untitled',
    collections: ['Untitled', 'Remote Play'],
    profile: 'Standard60',
    profiles: ['Standard60', 'QuickCast'],
    program: 'Intro',
    scenes: ['Chuni', 'WACCA', 'Nosta', 'Intro'],
    streaming: false,
    recording: false,
    service: null,
    calls: []
};
const items = {
    Chuni: [
        { sourceName: 'PLAYLAND-GAU-EAST', sourceType: 'OBS_SOURCE_TYPE_INPUT', inputKind: 'ndi_source', sceneItemEnabled: true, sceneItemTransform: { sourceWidth: 1920, sourceHeight: 1080 } },
        { sourceName: 'Waiting Music', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true },
        { sourceName: 'Hidden Clip', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: false },
        { sourceName: 'Overlay Group', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true, isGroup: true }
    ],
    'Overlay Group': [{ sourceName: 'Cue Monitor', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true }],
    WACCA: [{ sourceName: 'NDI WACCA', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true }]
};
const audio = {
    'PLAYLAND-GAU-EAST': { muted: false, monitor: 'OBS_MONITORING_TYPE_NONE', tracks: { 6: true } },
    'Waiting Music': { muted: true, monitor: 'OBS_MONITORING_TYPE_NONE', tracks: { 6: true } },
    'Cue Monitor': { muted: false, monitor: 'OBS_MONITORING_TYPE_MONITOR_ONLY', tracks: { 6: true } },
    'NDI WACCA': { muted: false, monitor: 'OBS_MONITORING_TYPE_NONE', tracks: { 6: false } },
    Mic: { muted: false, monitor: 'OBS_MONITORING_TYPE_NONE', tracks: { 6: true } }
};

const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, handleProtocols: (p) => (p.has('obswebsocket.json') ? 'obswebsocket.json' : false) });
let socket = null;
const emit = (eventType, eventData) => socket && socket.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: 1, eventData } }));

wss.on('connection', (ws) => {
    socket = ws;
    const salt = 'c2FsdA==';
    const challenge = crypto.randomBytes(8).toString('base64');
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.6.3', rpcVersion: 1, authentication: { salt, challenge } } }));
    ws.on('message', (buf) => {
        const msg = JSON.parse(buf.toString());
        if (msg.op === 1) {
            const secret = crypto.createHash('sha256').update(PASSWORD + salt).digest('base64');
            const want = crypto.createHash('sha256').update(secret + challenge).digest('base64');
            if (msg.d.authentication !== want) { ws.close(4009, 'Authentication failed.'); return; }
            assert.ok(msg.d.eventSubscriptions & (1 << 16), 'subscribes to InputVolumeMeters');
            ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
            return;
        }
        if (msg.op !== 6) return;
        const { requestType: t, requestId, requestData: q = {} } = msg.d;
        obs.calls.push(t);
        let ok = true;
        let data = {};
        let after = null;
        switch (t) {
            case 'GetSceneCollectionList': data = { currentSceneCollectionName: obs.collection, sceneCollections: obs.collections }; break;
            case 'SetCurrentSceneCollection': obs.collection = q.sceneCollectionName; obs.program = 'Chuni'; after = () => emit('CurrentSceneCollectionChanged', { sceneCollectionName: obs.collection }); break;
            case 'GetProfileList': data = { currentProfileName: obs.profile, profiles: obs.profiles }; break;
            case 'SetCurrentProfile': obs.profile = q.profileName; after = () => emit('CurrentProfileChanged', { profileName: obs.profile }); break;
            case 'GetSceneList': data = { currentProgramSceneName: obs.program, scenes: obs.scenes.map((sceneName, i) => ({ sceneName, sceneIndex: i })) }; break;
            case 'SetCurrentProgramScene': obs.program = q.sceneName; break;
            case 'GetStreamStatus': data = { outputActive: obs.streaming, outputReconnecting: false, outputTimecode: obs.streaming ? '00:01:02.500' : '00:00:00.000', outputDuration: 62500, outputCongestion: 0.02, outputBytes: obs.streaming ? 5000000 : 0, outputSkippedFrames: 3, outputTotalFrames: 3750 }; break;
            case 'GetRecordStatus': data = { outputActive: obs.recording }; break;
            case 'GetVideoSettings': data = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 }; break;
            case 'GetStats': data = { activeFps: 60.0000001, cpuUsage: 3.21, renderSkippedFrames: 0, renderTotalFrames: 1000 }; break;
            case 'GetSceneItemList': data = { sceneItems: items[q.sceneName] || [] }; break;
            case 'GetGroupSceneItemList': data = { sceneItems: items[q.sceneName] || [] }; break;
            case 'GetSpecialInputs': data = { desktop1: null, desktop2: null, mic1: 'Mic', mic2: null, mic3: null, mic4: null }; break;
            case 'GetProfileParameter':
                data = q.parameterName === 'Mode' ? { parameterValue: 'Advanced' } : { parameterValue: '6' };
                break;
            case 'GetInputAudioMonitorType': if (audio[q.inputName]) data = { monitorType: audio[q.inputName].monitor }; else ok = false; break;
            case 'GetInputAudioTracks': data = { inputAudioTracks: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, ...audio[q.inputName].tracks } }; break;
            case 'GetInputMute': data = { inputMuted: audio[q.inputName].muted }; break;
            case 'SetInputMute': audio[q.inputName].muted = q.inputMuted; break;
            case 'GetInputSettings':
                if (q.inputName === 'AV OSD Overlay' && !obs.osdInput) { ok = false; break; }
                data = { inputKind: 'ndi_source', inputSettings: q.inputName === 'PLAYLAND-GAU-EAST' ? { ndi_source_name: 'FAKE-MUX (Mux Output 1)' } : q.inputName === 'AV OSD Overlay' ? obs.osdInput.inputSettings : {} };
                break;
            case 'GetSourceActive': data = { videoActive: true, videoShowing: true }; break;
            // box OSD (avOsd.js): the overlay scene, its browser source, nesting it on program
            case 'CreateScene': obs.scenes.push(q.sceneName); items[q.sceneName] = []; break;
            case 'CreateInput': obs.osdInput = q; items[q.sceneName].push({ sourceName: q.inputName, sourceType: 'OBS_SOURCE_TYPE_INPUT', inputKind: q.inputKind, sceneItemEnabled: true, sceneItemId: 900 }); break;
            case 'SetInputSettings': obs.osdSet = q; break;
            case 'GetCurrentProgramScene': data = { currentProgramSceneName: obs.program }; break;
            case 'CreateSceneItem': (items[q.sceneName] = items[q.sceneName] || []).push({ sourceName: q.sourceName, sourceType: 'OBS_SOURCE_TYPE_SCENE', sceneItemEnabled: q.sceneItemEnabled !== false, sceneItemId: 777, sceneItemIndex: (items[q.sceneName] || []).length }); data = { sceneItemId: 777 }; break;
            case 'SetSceneItemIndex': break;
            case 'SetSceneItemEnabled': (items[q.sceneName] || []).forEach((i) => { if (i.sceneItemId === q.sceneItemId) i.sceneItemEnabled = q.sceneItemEnabled; }); break;
            case 'GetInputList': data = { inputs: [{ inputName: 'PLAYLAND-GAU-EAST', inputKind: 'ndi_source' }, { inputName: 'Mic', inputKind: 'wasapi_input_capture' }] }; break;
            case 'GetSourceScreenshot': data = { imageData: `data:image/jpg;base64,FAKE-${q.sourceName}-${q.imageWidth}` }; break;
            case 'SetStreamServiceSettings': obs.service = q; break;
            case 'StartStream':
                if (obs.service && obs.service.streamServiceSettings.key === 'bad-key-1234') { after = () => emit('StreamStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' }); break; }
                obs.streaming = true; after = () => emit('StreamStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
                break;
            case 'StopStream': obs.streaming = false; after = () => emit('StreamStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' }); break;
            default: ok = false;
        }
        ws.send(JSON.stringify({ op: 7, d: { requestType: t, requestId, requestStatus: { result: ok, code: ok ? 100 : 600, comment: ok ? undefined : `fake: ${t}` }, responseData: data } }));
        if (after) setTimeout(after, 20);
    });
});

// a cabinet mixer / muxer PC (no websocket password): a 59.94 fps camera in a 60 fps mix, a capture card
// with no signal, rendering lag, and an NDI output sending 60 fps
const mux = { frames: 0, render: 0, skipped: 0, calls: [] };
const muxT0 = Date.now();
const muxItems = {
    Show: [
        { sourceName: 'Overhead Cam', inputKind: 'dshow_input', sceneItemEnabled: true, sceneItemTransform: { sourceWidth: 1280, sourceHeight: 720 } },
        { sourceName: 'Game Card', inputKind: 'dshow_input', sceneItemEnabled: true, sceneItemTransform: { sourceWidth: 0, sourceHeight: 0 } },
        { sourceName: 'Off Cam', inputKind: 'dshow_input', sceneItemEnabled: false, sceneItemTransform: { sourceWidth: 0, sourceHeight: 0 } },
        { sourceName: 'Logo', inputKind: 'image_source', sceneItemEnabled: true, sceneItemTransform: { sourceWidth: 0, sourceHeight: 0 } }
    ]
};
const muxWss = new WebSocketServer({ host: '127.0.0.1', port: 0, handleProtocols: (p) => (p.has('obswebsocket.json') ? 'obswebsocket.json' : false) });
muxWss.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.4.2', rpcVersion: 1 } }));
    ws.on('message', (buf) => {
        const msg = JSON.parse(buf.toString());
        if (msg.op === 1) { assert.strictEqual(msg.d.eventSubscriptions, 0, 'a mux link subscribes to no events'); ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); return; }
        if (msg.op !== 6) return;
        const { requestType: t, requestId, requestData: q = {} } = msg.d;
        mux.calls.push(t);
        let data = {};
        let ok = true;
        switch (t) {
            case 'GetStats':
                // counters at a real 60 fps clock: 10% of rendered frames skipped
                mux.frames = Math.round((Date.now() - muxT0) * 0.06); mux.render = mux.frames; mux.skipped = Math.round(mux.frames / 10);
                data = { activeFps: 54, cpuUsage: 12, averageFrameRenderTime: 16.4, renderSkippedFrames: mux.skipped, renderTotalFrames: mux.render, outputSkippedFrames: 0, outputTotalFrames: mux.frames };
                break;
            case 'GetOutputList': data = { outputs: [{ outputName: 'NDI Main Output', outputKind: 'ndi_output', outputActive: true }, { outputName: 'adv_file_output', outputKind: 'ffmpeg_muxer', outputActive: false }] }; break;
            case 'GetOutputStatus': data = { outputActive: true, outputTotalFrames: Math.round((Date.now() - muxT0) * 0.06), outputSkippedFrames: 0 }; break;
            case 'GetVideoSettings': data = { fpsNumerator: 60, fpsDenominator: 1, baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 }; break;
            case 'GetCurrentProgramScene': data = { currentProgramSceneName: 'Show' }; break;
            case 'GetSceneItemList': data = { sceneItems: muxItems[q.sceneName] || [] }; break;
            case 'GetInputSettings': data = { inputSettings: q.inputName === 'Overhead Cam' ? { res_type: 1, frame_interval: 166833, buffering: 1 } : {} }; break;
            case 'GetSourceFilterList': data = { filters: q.sourceName === 'Overhead Cam' ? [{ filterKind: 'async_delay_filter', filterEnabled: true, filterSettings: { delay_ms: 120 } }] : [] }; break;
            case 'GetInputAudioSyncOffset': data = { inputAudioSyncOffset: 0 }; break;
            case 'GetSourceScreenshot': throw new Error('diagnostics must never take screenshots on a mux PC');
            default: ok = false;
        }
        ws.send(JSON.stringify({ op: 7, d: { requestType: t, requestId, requestStatus: { result: ok, code: ok ? 100 : 600 }, responseData: data } }));
    });
});

async function main() {
    await new Promise((r) => wss.on('listening', r));
    if (!muxWss.address()) await new Promise((r) => muxWss.on('listening', r));
    const port = wss.address().port;
    await new Promise((r) => google.listen(0, '127.0.0.1', r));
    const cabSrv = http.createServer((req, res) => {
        cab.hits.push(req.url);
        let body = '';
        if (req.url === '/power') body = cab.power;
        else if (req.url === '/game_power') body = cab.power === 'Active' ? 'Enabled' : 'Disabled';
        else if (req.url === '/select/game') body = cab.game;
        else if (req.url.startsWith('/power/')) { cab.power = { on: 'Active', standby: 'Standby', off: 'Power Off' }[req.url.slice(7)]; body = 'OK'; }
        else if (req.url.startsWith('/select/game/')) { cab.game = decodeURIComponent(req.url.slice(13)); body = 'OK'; }
        else body = 'OK';
        res.end(body);
    });
    await new Promise((r) => cabSrv.listen(0, '127.0.0.1', r));
    const C = `http://127.0.0.1:${cabSrv.address().port}`;
    const rp = [['Standby', 'Standby', 'orange'], ['Active', 'On', 'green'], ['Power Off', 'Off', 'white']];
    fs.writeFileSync(path.join(xdir, 'menu.json'), JSON.stringify({ devices: { chuni: { name: 'Chunithm', status: `${C}/power`, replace: rp, items: [
        { text: 'VISION Control', toggle: [{ text: 'AUTO', url: `${C}/v/auto` }, { text: 'V-BLK', url: `${C}/v/blank` }], children: [{ text: 'Auto-Select View', url: `${C}/v/auto` }, { text: 'Reset Encoder', url: `${C}/v/reset` }] },
        { text: 'Power Switch', status: `${C}/power`, replace: rp, warning: { header: 'System Active', message: 'Sessions will be interrupted', check: `${C}/game_power`, match: 'Enabled' },
            toggle: [{ text: 'I', url: `${C}/power/on`, match: [{ str: 'On' }] }, { text: 'STB', url: `${C}/power/standby`, match: [{ str: 'Standby' }] }, { text: 'O', url: `${C}/power/off` }] },
        { text: 'Game Select', status: `${C}/select/game`, children: [{ text: 'Verse', url: `${C}/select/game/Verse` }, { text: 'Luminous Plus', url: `${C}/select/game/Luminous%20Plus` }] },
        { text: 'Maintenance', children: [{ text: 'Reboot MCU', url: `${C}/reboot` }] }
    ] } } }));
    process.env.QUICKCAST_GOOGLE_BASE = `http://127.0.0.1:${google.address().port}`;
    process.env.QUICKCAST_YT_BASE = `http://127.0.0.1:${google.address().port}/yt`;
    // ssh to a host that cannot exist, so a launch attempt fails fast instead of reaching Ruiko
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ obs: { host: '127.0.0.1', port, password: PASSWORD }, launch: { ssh: 'quickcast-test.invalid' }, muxes: { 'FAKE-MUX': { host: '127.0.0.1', port: muxWss.address().port } } }));
    const qc = require('../modules/quickcast');
    const { validateManifest } = require('../modules/melatonPackageStore');

    // the package manifest (system package with styles)
    validateManifest(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'quickcast', 'manifest.json'), 'utf8')), { trusted: true });

    // status: connected, auth ok, cabinets from the defaults, not present outside Remote Play
    let st = await qc.status();
    assert.strictEqual(st.obs.state, 'online');
    assert.strictEqual(st.obs.version, '5.6.3');
    assert.deepStrictEqual(st.cabinets.map((c) => c.id), ['chuni', 'wacca', 'nost', 'h2h']);
    assert.ok(st.cabinets.every((c) => !c.present), 'no cabinet outside the Remote Play collection');
    assert.strictEqual(st.key.set, false);
    assert.strictEqual(st.video.fps, 60);

    // pipeline diagnostics: the cabinet's feed on Ruiko names its mux PC, which is read for stats only
    for (let i = 0; i < 8; i++) { st = await qc.status({ cabinet: 'chuni' }); await new Promise((res) => setTimeout(res, 450)); }
    const dg = st.diag;
    assert.strictEqual(dg.input.source, 'FAKE-MUX');
    const stIn = Object.fromEntries(dg.input.stages.map((x) => [x.id, x]));
    assert.deepStrictEqual(Object.keys(stIn), ['capture', 'clock', 'mixer', 'ndiout', 'link', 'lock']);
    assert.deepStrictEqual(dg.input.stages.map((x) => x.col), [0, 1, 2, 3, 4, 5], 'input stages fill the shared columns');
    assert.strictEqual(stIn.lock.value, '1:1 LOCKED');
    assert.strictEqual(stIn.capture.blink, true, 'a 59.94 fps camera in a 60 fps mix blinks');
    assert.strictEqual(stIn.clock.state, 'warn', '54 of 60 fps: the mux is not holding its clock');
    assert.strictEqual(stIn.clock.blink, true);
    const diag = require('../modules/quickcastDiag');
    assert.strictEqual(diag.lockRatio(30, 60), '1:2');
    assert.strictEqual(diag.lockRatio(60, 60), '1:1');
    assert.strictEqual(diag.lockRatio(120, 60), '2:1');
    assert.strictEqual(diag.lockRatio(59.94, 60), null, '59.94 into 60 cannot lock');
    assert.strictEqual(diag.lockRatio(30000 / 1001, 60000 / 1001), '1:2');
    assert.strictEqual(diag.lockRatio(25, 60), null);
    assert.strictEqual(stIn.capture.state, 'bad', 'a 0x0 capture has no signal');
    assert.match(stIn.capture.detail, /Game Card.*NO SIGNAL/);
    assert.match(stIn.capture.detail, /Overhead Cam.*59\.94 fps target.*buffering on.*video delay 120 ms.*does not fit 60 fps/);
    assert.ok(!/Off Cam|Logo/.test(stIn.capture.detail), 'hidden items and non-captures are left out');
    assert.strictEqual(stIn.mixer.state, 'bad', '10% render lag at 54 of 60 fps');
    assert.match(stIn.mixer.detail, /(9\.\d|10(\.\d)?)% of frames skipped for rendering lag/);
    assert.strictEqual(stIn.ndiout.state, 'ok');
    assert.strictEqual(stIn.link.state, 'ok');
    const cam = dg.input.captures.find((c) => c.name === 'Overhead Cam');
    assert.deepStrictEqual([cam.fps, cam.buffering, cam.delayMs], [59.94, 'on', 120]);
    const stOut = Object.fromEntries(dg.output.stages.map((x) => [x.id, x]));
    assert.deepStrictEqual(Object.keys(stOut), ['rx', 'clock', 'render', 'encoder', 'network', 'youtube']);
    assert.deepStrictEqual(dg.output.stages.map((x) => x.col), [0, 1, 2, 3, 4, 5], 'output stages line up under the input ones');
    assert.deepStrictEqual(dg.columns, ['SOURCE', 'CLOCK', 'PROCESS', 'ENCODE', 'TRANSPORT', 'DESTINATION']);
    assert.strictEqual(stOut.rx.state, 'ok');
    assert.strictEqual(stOut.rx.value, '1920x1080');
    assert.strictEqual(stOut.encoder.state, 'off', 'not streaming');
    assert.strictEqual(dg.verdict.stage, 'capture', 'the first failing stage in signal order');
    assert.strictEqual(dg.verdict.state, 'bad');
    assert.ok(!mux.calls.includes('GetSourceScreenshot'));
    st = await qc.status({ cabinet: 'nost' });
    assert.match(st.diag.input.note, /Looking for/, 'the feed is scanned in the background, never waited on');
    await new Promise((res) => setTimeout(res, 300));
    st = await qc.status({ cabinet: 'nost' });
    assert.match(st.diag.input.note, /no NDI feed/, 'a scene without an NDI source has no mux to check');

    // box OSD: MENU on the satellite puts the overlay on top of program; EXIT takes it off
    obs.program = 'Chuni';
    let v = await qc.osd.press('sat', '', 'menu');
    assert.strictEqual(v.open, true);
    assert.strictEqual(v.page.title, 'MAIN MENU');
    const until = async (fn, ms = 3000) => { const t = Date.now() + ms; while (!fn() && Date.now() < t) await new Promise((r) => setTimeout(r, 25)); return fn(); };
    await until(() => obs.osdInput && items.Chuni.some((i) => i.sourceName === 'AV OSD' && i.sceneItemEnabled));
    assert.ok(obs.osdInput && obs.osdInput.inputKind === 'browser_source', 'the OSD browser source is created on the box');
    assert.match(obs.osdInput.inputSettings.url, /\/av-osd\/sat\?k=[\w-]{20,}$/);
    const nested = items.Chuni.find((i) => i.sourceName === 'AV OSD');
    assert.ok(nested && nested.sceneItemEnabled, 'the OSD scene is nested on program, shown');
    v = await qc.osd.press('sat', '', 'down');
    assert.strictEqual(v.page.cursor, 1);
    v = await qc.osd.press('sat', '', 'up');
    v = await qc.osd.press('sat', '', 'ok');
    assert.strictEqual(v.page.title, 'INPUT ASSIGNMENT');
    assert.ok(v.page.rows.some((r) => /PLAYLAND-GAU-EAST/.test(r.label) && r.type === 'NDI'), 'NDI inputs are listed with their port type');
    v = await qc.osd.press('sat', '', 'exit');
    assert.strictEqual(v.page.title, 'MAIN MENU');
    v = await qc.osd.press('sat', '', 'exit');
    assert.strictEqual(v.open, false);
    await until(() => !nested.sceneItemEnabled);
    assert.strictEqual(nested.sceneItemEnabled, false, 'closing hides the OSD layer');
    await assert.rejects(qc.osd.press('sat', '', 'reboot'), /Unknown key/);
    const tok = new URL(obs.osdInput.inputSettings.url).searchParams.get('k');
    assert.ok(qc.osd.checkToken('sat', tok));
    assert.ok(!qc.osd.checkToken('sat', 'x'.repeat(tok.length)), 'a wrong token is refused');
    assert.ok(!qc.osd.checkToken('mux-FAKE-MUX', tok), 'a token only opens its own box');
    assert.strictEqual(fs.statSync(path.join(dir, 'osd.json')).mode & 0o777, 0o600);
    const lag = qc.osd.bestLag([0, 0, 0, 9, 9, 9, 3, 3, 8, 8, 8, 1, 1, 1, 6, 6], [0, 9, 9, 9, 3, 3, 8, 8, 8, 1, 1, 1, 6, 6, 6, 6], 4);
    assert.ok(Math.abs(lag.lag - 2) < 0.3 && lag.score > 0.9, 'a camera 2 samples behind reads +2');

    // go live without a key is refused before OBS is touched
    await assert.rejects(qc.goLive('chuni'), /stream key/);
    await assert.rejects(qc.prepare('nope'), /Unknown cabinet/);

    // prepare: collection, profile, scene
    let r = await qc.prepare('chuni');
    assert.deepStrictEqual(r.steps, ['collection', 'profile']); // the switch to Remote Play lands on Chuni already
    assert.strictEqual(obs.collection, 'Remote Play');
    assert.strictEqual(obs.profile, 'QuickCast');
    r = await qc.prepare('wacca');
    assert.deepStrictEqual(r.steps, ['scene']);
    assert.strictEqual(obs.program, 'WACCA');
    await assert.rejects(qc.prepare('h2h'), /missing on RUIKO/);

    // meters: only what the stream hears (enabled items, groups, global mic; not monitor-only, not off-track)
    await qc.prepare('chuni');
    emit('InputVolumeMeters', { inputs: [
        { inputName: 'PLAYLAND-GAU-EAST', inputLevelsMul: [[0.5, 0.7, 0.7], [0.25, 0.3, 0.3]] },
        { inputName: 'Waiting Music', inputLevelsMul: [[1, 1, 1], [1, 1, 1]] },
        { inputName: 'Cue Monitor', inputLevelsMul: [[1, 1, 1], [1, 1, 1]] },
        { inputName: 'Mic', inputLevelsMul: [[0.1, 0.1, 0.1]] }
    ] });
    await new Promise((res) => setTimeout(res, 50));
    st = await qc.status();
    assert.strictEqual(st.programCabinet, 'chuni');
    assert.ok(st.cabinets.find((c) => c.id === 'chuni').present);
    assert.deepStrictEqual(st.inputs.map((i) => i.name).sort(), ['Mic', 'PLAYLAND-GAU-EAST', 'Waiting Music']);
    assert.strictEqual(st.inputs.find((i) => i.name === 'Waiting Music').muted, true);
    assert.strictEqual(st.master.mag[0], -6); // 0.5 -> -6.0 dB; the muted 0 dB music is left out
    assert.strictEqual(st.master.peak[1], -10.5); // 0.3 -> -10.5 dB
    st = await qc.status();
    assert.strictEqual(st.master.mag[0], -100, 'meters reset after a read');
    // mute: only inputs the stream hears
    await assert.rejects(qc.setMute('Cue Monitor', true), /not in the stream mix/);
    let mu = await qc.setMute('Waiting Music', false);
    assert.deepStrictEqual(mu, { ok: true, name: 'Waiting Music', muted: false });
    assert.strictEqual(audio['Waiting Music'].muted, false);
    await qc.setMute('Waiting Music', true);

    // preview
    const pv = await qc.preview('chuni', 4000);
    assert.strictEqual(pv.image, 'data:image/jpg;base64,FAKE-Chuni-1280');

    // stream key: validated, 0600, never in status
    assert.throws(() => qc.setKey('has spaces in it'), /stream key/);
    assert.throws(() => qc.setKey(undefined, 'https://evil.example/'), /youtube\.com/);
    r = qc.setKey('abcd-efgh-ijkl-mnop-qrst', 'https://www.youtube.com/@arcade/live');
    assert.strictEqual(r.key.hint, '••••-qrst');
    assert.strictEqual(fs.statSync(path.join(dir, 'config.json')).mode & 0o777, 0o600);
    st = await qc.status();
    assert.ok(!JSON.stringify(st).includes('abcd-efgh'), 'the key never reaches the client');
    assert.strictEqual(st.watchUrl, 'https://www.youtube.com/@arcade/live');

    // go live from another profile while recording: refused
    obs.profile = 'Standard60';
    obs.recording = true;
    await assert.rejects(qc.goLive('wacca'), /recording/);
    obs.recording = false;

    // go live: profile, key into the service, scene, start
    r = await qc.goLive('wacca');
    assert.ok(r.ok);
    assert.strictEqual(obs.profile, 'QuickCast');
    assert.strictEqual(obs.program, 'WACCA');
    assert.strictEqual(obs.streaming, true);
    assert.deepStrictEqual(obs.service.streamServiceSettings, { service: 'YouTube - RTMPS', server: 'rtmps://a.rtmps.youtube.com:443/live2', key: 'abcd-efgh-ijkl-mnop-qrst', bwtest: false });
    st = await qc.status();
    assert.strictEqual(st.stream.active, true);
    assert.strictEqual(st.stream.timecode, '00:01:02.500');
    assert.strictEqual(st.stream.congestion, 2);
    assert.ok((await qc.goLive('wacca')).already);

    // while live: switching the cabinet needs confirmation; collection / profile never switch
    const calls = obs.calls.length;
    r = await qc.prepare('chuni');
    assert.strictEqual(r.needsConfirm, true);
    assert.strictEqual(obs.program, 'WACCA');
    assert.ok(!obs.calls.slice(calls).some((c) => c === 'SetCurrentSceneCollection' || c === 'SetCurrentProfile'));
    r = await qc.prepare('chuni', true);
    assert.deepStrictEqual(r.steps, ['scene']);
    assert.strictEqual(obs.program, 'Chuni');

    // stop
    r = await qc.stop();
    assert.ok(r.ok);
    assert.strictEqual(obs.streaming, false);
    assert.ok((await qc.stop()).already);

    // ---- YouTube: credentials, sign-in, broadcast with the title, chat
    const y = qc.youtube;
    assert.throws(() => y.setCredentials({ clientId: 'nope' }), /googleusercontent/);
    y.setCredentials({ apiKey: 'AIzaFakeKeyFakeKeyFakeKey123', clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-fakesecret' });
    assert.deepStrictEqual(y.account(), { profile: null, channels: [], apiKey: true, client: true, clientId: '123-\u2026', signedIn: false, channel: '', channelId: '' });
    const si = await y.signInStart();
    assert.strictEqual(si.userCode, 'ABCD-EFGH');
    for (let i = 0; i < 100 && y.signInState().state === 'waiting'; i++) await new Promise((res) => setTimeout(res, 20));
    assert.strictEqual(y.signInState().state, 'done');
    assert.strictEqual(y.account().channel, 'Kamisato Tadashi');
    assert.deepStrictEqual(y.account().profile, { id: 'UCfakechannelfakechannel', title: 'Kamisato Tadashi', handle: '@rhythmgamer', avatar: 'https://yt3.example/a.jpg', subscribers: 425, videos: 28 });
    assert.deepStrictEqual(y.account().channels.map((c) => [c.id, c.active]), [['UCfakechannelfakechannel', true]]);
    assert.ok(!JSON.stringify(y.account()).includes('rt-1'), 'no tokens in the account');
    assert.throws(() => y.selectAccount('UCnope'), /not signed in/);
    st = await qc.status();
    assert.ok(!JSON.stringify(st).includes('GOCSPX') && !JSON.stringify(st).includes('rt-1') && !JSON.stringify(st).includes('AIzaFake'), 'no secrets in status');
    await assert.rejects(qc.goLive('chuni', { title: '' }), /title is empty/);
    r = await qc.goLive('chuni', { title: 'Chunithm After Dark', privacy: 'unlisted' });
    assert.ok(r.ok && r.broadcast && r.broadcast.id === 'vid-1');
    assert.strictEqual(g.broadcasts[0].snippet.title, 'Chunithm After Dark');
    assert.strictEqual(g.broadcasts[0].status.privacyStatus, 'unlisted');
    assert.strictEqual(g.broadcasts[0].contentDetails.enableAutoStart, true);
    assert.deepStrictEqual(g.bound[0], ['vid-1', 'stream-9']);
    assert.strictEqual(y.lastSettings().title, 'Chunithm After Dark', 'the title pre-fills next time');
    st = await qc.status();
    assert.strictEqual(st.youtube.broadcast.watchUrl, 'https://www.youtube.com/watch?v=vid-1');
    assert.strictEqual(st.youtube.broadcast.shortUrl, 'https://youtu.be/vid-1');
    // chat
    let c = y.chatRead(0);
    for (let i = 0; i < 50 && !c.messages.length; i++) { await new Promise((res) => setTimeout(res, 20)); c = y.chatRead(0); }
    assert.deepStrictEqual(c.messages.map((m) => [m.author, m.text, m.mod, m.amount]), [['viewer', 'hello <b>', true, ''], ['fan', 'gg', false, '\u00a5500']]);
    assert.strictEqual(c.canReply, true);
    await y.chatSend('thanks for watching');
    assert.deepStrictEqual(g.sent, ['thanks for watching']);
    c = y.chatRead(2);
    assert.deepStrictEqual(c.messages.map((m) => [m.text, m.owner]), [['thanks for watching', true]]);
    await assert.rejects(y.chatSend('x'.repeat(201)), /200 characters/);
    // live title change
    r = await y.saveSettings({ title: 'New title', applyLive: true });
    assert.ok(r.updatedLive);
    assert.strictEqual(g.videos[g.videos.length - 1].snippet.title, 'New title');
    await qc.stop();
    await new Promise((res) => setTimeout(res, 50));
    assert.deepStrictEqual(g.transitions, ['complete']);
    y.signOut();
    assert.strictEqual(y.account().signedIn, false);
    assert.deepStrictEqual(y.account().channels, []);
    y._chat.leaseAt = 0;

    // ---- XLink cabinet control: video / encoder, power (with XLink's warning), game; nothing else
    let x = await qc.cabinetControls('h2h');
    assert.strictEqual(x.device.key, 'chuni', 'H2H uses the Chunithm cabinet');
    assert.deepStrictEqual(x.video.buttons.map((b) => b.label), ['GAME', 'V-BLK']);
    assert.deepStrictEqual(x.video.resetPath, [0, 1]);
    assert.deepStrictEqual(x.power.buttons.map((b) => [b.label, b.active]), [['I', true], ['STB', false], ['O', false]]);
    assert.strictEqual(x.game.status.text, 'Verse');
    assert.deepStrictEqual(x.game.options.map((o) => o.text), ['Verse', 'Luminous Plus']);
    assert.strictEqual((await qc.cabinetControls('wacca')).available, false, 'no XLink device for WACCA in this menu');
    await assert.rejects(qc.cabinetAction({ cabinet: 'chuni', path: [3, 0], op: 'send' }), /only use/);
    await assert.rejects(qc.cabinetAction({ cabinet: 'chuni', path: [0, 0], op: 'send' }), /only use/, 'only Reset Encoder under VISION Control');
    let xa = await qc.cabinetAction({ cabinet: 'chuni', path: [0], op: 'toggle', value: 1 });
    assert.ok(xa.ok && cab.hits.includes('/v/blank'));
    xa = await qc.cabinetAction({ cabinet: 'chuni', path: [0, 1], op: 'send' });
    assert.ok(xa.ok && cab.hits.includes('/v/reset'));
    xa = await qc.cabinetAction({ cabinet: 'chuni', path: [1], op: 'toggle', value: 1 });
    assert.strictEqual(xa.confirm.header, 'System Active', "XLink's own warning comes back first");
    assert.strictEqual(cab.power, 'Active');
    xa = await qc.cabinetAction({ cabinet: 'chuni', path: [1], op: 'toggle', value: 1, confirmed: true });
    assert.ok(xa.ok);
    assert.strictEqual(cab.power, 'Standby');
    assert.deepStrictEqual(xa.controls.power.buttons.map((b) => b.active), [false, true, false]);
    xa = await qc.cabinetAction({ cabinet: 'chuni', path: [2, 1], op: 'send' });
    assert.strictEqual(cab.game, 'Luminous Plus');
    assert.ok(!cab.hits.includes('/reboot'));
    cabSrv.close();

    // a rejected key: OBS stops at once -> a clear failure
    qc.setKey('bad-key-1234');
    await assert.rejects(qc.goLive('chuni'), /could not connect to YouTube/);

    // one long operation at a time
    const a = qc.prepare('wacca');
    await assert.rejects(qc.stop(), /busy/);
    await a;

    // wrong websocket password: an auth failure, not a launch
    qc._link.close();
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    raw.obs.password = 'wrong';
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(raw));
    fs.utimesSync(path.join(dir, 'config.json'), new Date(), new Date(Date.now() + 5000));
    await assert.rejects(qc.prepare('chuni'), /password/);

    // OBS down: status says offline, never throws
    qc._link.close();
    raw.obs.port = 1;
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(raw));
    fs.utimesSync(path.join(dir, 'config.json'), new Date(), new Date(Date.now() + 10000));
    await new Promise((res) => setTimeout(res, 2100));
    st = await qc.status();
    assert.strictEqual(st.obs.state, 'offline');
    assert.match(st.obs.error, /not running/);

    console.log('quickcast: all checks passed');
    qc._link.close();
    wss.close();
    muxWss.close();
    google.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(xdir, { recursive: true, force: true });
    process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
