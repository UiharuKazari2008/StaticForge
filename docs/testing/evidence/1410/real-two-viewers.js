// Two viewers on one REAL relay session, in this process only: own folders and record files, a local express app with
// no auth on 127.0.0.1. The running server's sessions are not touched. node real-two-viewers.js kick|youtube
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const R = '/home/kanmi/staticforge';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'two-viewers-'));
process.env.VIDEOS_LIVE_DIR = path.join(tmp, 'live'); process.env.VIDEOS_LIVE_STORE = path.join(tmp, 'live.json');
process.env.VIDEOS_YT_DIR = path.join(tmp, 'yt'); process.env.VIDEOS_YT_STORE = path.join(tmp, 'yt.json');
const kind = process.argv[2];
const express = require(R + '/node_modules/express');
const relay = require(R + (kind === 'kick' ? '/modules/videosKickRelay' : '/modules/videosYoutubeRelay'));
const say = (t) => console.log(`${new Date().toTimeString().slice(0, 8)} ${t}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
    if (kind === 'kick') relay.bind({ allowed: (s) => s === 'asmongold' });
    const app = express(); relay.mount(app, (q, r, n) => n());
    const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const ask = async (url) => { const r = await fetch(base + url); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, b }; };
    const play = async (url, label) => {
        const l = await ask(url); const pieces = l.b.toString().split('\n').filter((x) => /^s\d+\.ts$/.test(x));
        let piece = '';
        if (l.status === 200 && pieces.length) { const p = await ask(url.replace('index.m3u8', pieces[pieces.length - 1])); piece = ` piece ${pieces[pieces.length - 1]} ${p.status} ${p.b.length} bytes`; }
        say(`${label}: playlist ${l.status} (${pieces.length} pieces)${piece}`);
        return l.status;
    };
    const start = (v) => (kind === 'kick' ? relay.start('asmongold', '160', v) : relay.start('aqz-KE-bpKQ', 'v144', 0, v));
    const stop = (id, v) => (kind === 'kick' ? relay.stop(id, 'viewer', { viewer: v }) : relay.stop(id, { viewer: v }));
    const recs = () => { try { return fs.readFileSync(kind === 'kick' ? process.env.VIDEOS_LIVE_STORE : process.env.VIDEOS_YT_STORE, 'utf8'); } catch (_) { return '(none)'; } };
    const a = await start('v:phone'); const b = await start('v:desktop');
    say(`phone started ${a.id}, desktop got ${b.id}: ${a.id === b.id ? 'one shared session' : 'TWO SESSIONS'}`);
    await play(a.url, 'both on it'); say(`records: ${recs()}`);
    say(`phone stops -> stopped: ${await stop(a.id, 'v:phone')}`);
    await wait(500); say(`records: ${recs()}`);
    for (let i = 0; i < 3; i++) { await wait(5000); await play(b.url, 'desktop still playing'); }
    say(`desktop (last) stops -> stopped: ${await stop(b.id, 'v:desktop')}`);
    await wait(1500); await play(b.url, 'after the last stop'); say(`state: ${relay.state(b.id).state}; records: ${recs()}`);
    srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { say(`error: ${e.code || ''} ${e.message}`); process.exit(1); });
