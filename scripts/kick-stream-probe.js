#!/usr/bin/env node
/**
 * Probe for Melaton Videos' Kick relay (Yukimi allowed this script by a permission rule, Nov 18 2026):
 * can the server's Alchemy browser, opening a Kick channel's page like any viewer, read the stream's
 * playback address, and can the server pull that stream?
 *
 *   node scripts/kick-stream-probe.js <channel>            address + the stream's renditions
 *   node scripts/kick-stream-probe.js <channel> --pull N   also pull N seconds of the lowest and the
 *                                                          best rendition with ffmpeg (copy, no encode)
 *   node scripts/kick-stream-probe.js <channel> --relay <mode> [N]  run the relay module itself for N seconds
 *   node scripts/kick-stream-probe.js <channel> --bench N  N seconds of each candidate encode, with the
 *                                                          processor time each one costs
 *
 * Prints shapes and numbers; the address itself (it carries a viewing token) goes only to the file named
 * by --save <file>.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const slug = String(process.argv[2] || '').toLowerCase();
if (!/^[a-z0-9_-]{2,40}$/.test(slug)) { console.log('usage: kick-stream-probe.js <channel> [--pull seconds] [--save file]'); process.exit(2); }
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: Number(process.env.ALCHEMY_CDP_PORT || 9339), path: p }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));

async function inPage(url, expression, waitMs = 30000) {
    const v = await get('/json/version');
    const ws = new WebSocket(v.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    let id = 0;
    const wait = new Map();
    ws.on('message', (m) => { const x = JSON.parse(m); const w = x.id && wait.get(x.id); if (!w) return; wait.delete(x.id); if (x.error) w.rej(new Error(x.error.message)); else w.res(x.result); });
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify(Object.assign({ id: i, method, params }, sessionId ? { sessionId } : {}))); });
    let targetId;
    try {
        let t;
        try { t = await send('Target.createTarget', { url: 'about:blank#alchemy-quiet', background: true, hidden: true }); } catch (_) { t = await send('Target.createTarget', { url: 'about:blank#alchemy-quiet', background: true }); }
        targetId = t.targetId;
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        await send('Page.navigate', { url }, sessionId);
        const t0 = Date.now();
        while (Date.now() - t0 < waitMs) {
            await new Promise((r) => setTimeout(r, 800));
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId).catch(() => null);
            const val = r && r.result && r.result.value;
            if (val) return { value: val, ms: Date.now() - t0 };
        }
        return { value: null, ms: waitMs };
    } finally {
        if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {});
        ws.close();
    }
}

function pull(url, seconds, out) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', url, '-t', String(seconds), '-c', 'copy', out], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', (d) => { err += d; });
        p.on('close', (code) => resolve({ code, ms: Date.now() - t0, bytes: fs.existsSync(out) ? fs.statSync(out).size : 0, err: err.trim().split('\n').slice(-2).join(' | ').slice(0, 300) }));
    });
}

// --relay <mode> [seconds]: the real relay module (modules/videosKickRelay.js): start, watch its list fill, stop
async function relayTest(mode, seconds) {
    const relay = require('../modules/videosKickRelay');
    process.env.VIDEOS_LIVE_DIR = process.env.VIDEOS_LIVE_DIR || path.join(os.tmpdir(), 'kick-probe-live');
    const t0 = Date.now();
    const s = await relay.start(slug, mode);
    console.log(`relay ${mode}: ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify({ state: s.state, source: s.source, url: s.url.replace(s.id, '<id>') }));
    const dir = relay._test.sessions.get(s.id).dir;
    const end = Date.now() + seconds * 1000;
    let last = '';
    while (Date.now() < end) {
        await new Promise((r) => setTimeout(r, 4000));
        relay.state(s.id); // someone is watching
        const list = fs.readFileSync(path.join(dir, 'index.m3u8'), 'utf8');
        const segs = list.split('\n').filter((l) => l.endsWith('.ts'));
        const sizes = segs.map((f) => { try { return fs.statSync(path.join(dir, f)).size; } catch (_) { return 0; } });
        const durs = (list.match(/#EXTINF:([\d.]+)/g) || []).map((x) => Number(x.split(':')[1]));
        const line = `${segs.length} pieces, newest ${segs[segs.length - 1]}, ${Math.round((sizes.reduce((a, b) => a + b, 0) * 8) / Math.max(1, durs.reduce((a, b) => a + b, 0)) / 1000)} kbit/s, piece ${durs[durs.length - 1]} s`;
        if (line !== last) { console.log('  ', line); last = line; }
    }
    const st = relay.state(s.id);
    console.log('  state at end:', st.state, 'restarts', st.restarts);
    await relay.stop(s.id);
    console.log('  stopped; files left:', fs.existsSync(dir));
}

(async () => {
    if (arg('--relay')) { await relayTest(arg('--relay'), Number(process.argv[process.argv.indexOf('--relay') + 2]) || 24); return; }
    // on the channel's own page: the page's own channel data (what its player reads)
    const expr = `(async () => {
        if (location.hostname !== 'kick.com' || document.readyState === 'loading') return null;
        try {
            const r = await fetch('/api/v2/channels/${slug}', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
            const text = await r.text();
            let j = null;
            try { j = JSON.parse(text); } catch (_) { /* not JSON: a challenge page */ }
            return JSON.stringify({ status: r.status, bytes: text.length, title: document.title.slice(0, 60), live: !!(j && j.livestream), playback: (j && j.playback_url) || '', head: j ? '' : text.slice(0, 100) });
        } catch (e) { return JSON.stringify({ error: e.message }); }
    })()`;
    const r = await inPage(`https://kick.com/${slug}`, expr);
    if (!r.value) { console.log('the page did not load in time', r.ms, 'ms'); return; }
    const j = JSON.parse(r.value);
    const u = j.playback ? new URL(j.playback) : null;
    console.log('page read:', JSON.stringify({ ms: r.ms, status: j.status, bytes: j.bytes, title: j.title, live: j.live, error: j.error, head: j.head, playbackHost: u && u.host, playbackFile: u && path.basename(u.pathname), query: u && [...u.searchParams.keys()] }));
    if (!u) return;
    if (arg('--save')) fs.writeFileSync(arg('--save'), j.playback, { mode: 0o600 });
    const m = await fetch(j.playback);
    const text = await m.text();
    console.log('master playlist:', m.status, text.length, 'bytes');
    const variants = [];
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        if (!line.startsWith('#EXT-X-STREAM-INF')) return;
        const attr = (k) => (new RegExp(`${k}=("([^"]*)"|[^,]*)`).exec(line) || [])[1];
        variants.push({ res: attr('RESOLUTION'), bandwidth: Number(attr('BANDWIDTH')), fps: attr('FRAME-RATE'), codecs: (attr('CODECS') || '').replace(/"/g, ''), url: new URL(lines[i + 1].trim(), j.playback).toString() });
    });
    variants.forEach((v) => console.log('  rendition', v.res, `${Math.round(v.bandwidth / 1000)} kbit/s`, `${v.fps} fps`, v.codecs));
    // --bench N: N seconds of each candidate encode from the live stream; cpu = processor seconds used per
    // second of stream (1.0 = one core busy), so what the server can keep up for hours is measured, not guessed
    const bench = Number(arg('--bench')) || 0;
    if (bench && variants.length) {
        const by = (h) => variants.find((v) => String(v.res).endsWith(`x${h}`)) || variants[0];
        const x264 = (h, kbit, preset, extra = []) => ['-vf', `fps=30,scale=-2:${h}:flags=lanczos`, '-c:v', 'libx264', '-preset', preset, '-b:v', `${kbit}k`, '-maxrate', `${Math.round(kbit * 1.3)}k`, '-bufsize', `${kbit * 3}k`, '-g', '60', ...extra, '-c:a', 'aac', '-b:a', '96k', '-ac', '2'];
        const tests = [
            ['480p30 x264 medium 800k (from 480p)', by(480), x264(480, 800, 'medium')],
            ['480p30 x264 slow 800k (from 480p)', by(480), x264(480, 800, 'slow')],
            ['360p30 x264 slow 400k (from 480p)', by(480), x264(360, 400, 'slow')],
            ['360p24 x264 slower 350k (from 480p)', by(480), ['-vf', 'fps=24,scale=-2:360:flags=lanczos', '-c:v', 'libx264', '-preset', 'slower', '-b:v', '350k', '-maxrate', '460k', '-bufsize', '1050k', '-g', '48', '-c:a', 'aac', '-b:a', '80k', '-ac', '2']],
            ['540p30 vaapi (hardware) 1100k', by(720), ['-vaapi_device', '/dev/dri/renderD128', '-vf', 'fps=30,format=nv12,hwupload,scale_vaapi=w=-2:h=540', '-c:v', 'h264_vaapi', '-b:v', '1100k', '-maxrate', '1400k', '-g', '60', '-c:a', 'aac', '-b:a', '96k', '-ac', '2']]
        ];
        for (const [name, v, args] of tests) {
            const out = path.join(os.tmpdir(), 'kick-probe-bench.ts');
            const r = await new Promise((resolve) => {
                const t0 = Date.now();
                const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-nostats', '-benchmark', '-y', '-i', v.url, '-t', String(bench), ...args, '-f', 'mpegts', out], { stdio: ['ignore', 'ignore', 'pipe'] });
                let err = '';
                p.stderr.on('data', (d) => { err += d; });
                p.on('close', (code) => {
                    const m = /utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s/.exec(err);
                    resolve({ code, wall: (Date.now() - t0) / 1000, cpu: m ? (Number(m[1]) + Number(m[2])) / bench : null, bytes: fs.existsSync(out) ? fs.statSync(out).size : 0, err: err.replace(/bench:.*/g, '').trim().split('\n').slice(-1)[0].slice(0, 160) });
                });
            });
            console.log(`  ${name.padEnd(38)} cpu ${r.cpu == null ? '?' : r.cpu.toFixed(2)} cores  took ${r.wall.toFixed(1)} s for ${bench} s  ${Math.round((r.bytes * 8) / bench / 1000)} kbit/s${r.code ? `  FAILED: ${r.err}` : ''}`);
            try { fs.unlinkSync(out); } catch (_) { /* gone */ }
        }
        return;
    }
    const secs = Number(arg('--pull')) || 0;
    if (!secs || !variants.length) return;
    const sorted = variants.slice().sort((a, b) => a.bandwidth - b.bandwidth);
    for (const [name, v] of [['lowest', sorted[0]], ['best', sorted[sorted.length - 1]]]) {
        const out = path.join(os.tmpdir(), `kick-probe-${name}.ts`);
        const p = await pull(v.url, secs, out);
        console.log(`  pull ${name} (${v.res}) ${secs} s:`, JSON.stringify({ code: p.code, ms: p.ms, kB: Math.round(p.bytes / 1000), kbit: Math.round((p.bytes * 8) / secs / 1000), err: p.err }));
        try { fs.unlinkSync(out); } catch (_) { /* gone */ }
    }
})().catch((e) => { console.log('FAIL', e.message); process.exit(0); });
