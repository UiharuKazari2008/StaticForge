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
        { sourceName: 'PLAYLAND-GAU-EAST', sourceType: 'OBS_SOURCE_TYPE_INPUT', sceneItemEnabled: true },
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

async function main() {
    await new Promise((r) => wss.on('listening', r));
    const port = wss.address().port;
    // ssh to a host that cannot exist, so a launch attempt fails fast instead of reaching Ruiko
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ obs: { host: '127.0.0.1', port, password: PASSWORD }, launch: { ssh: 'quickcast-test.invalid' } }));
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
    await assert.rejects(qc.prepare('h2h'), /missing from OBS/);

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
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
