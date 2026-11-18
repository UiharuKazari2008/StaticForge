/**
 * Melaton Videos: watch a Kick live stream in the program, through the server (Yozora #918).
 *
 * Yukimi, Nov 18 2026: Kick's own app "boils the phone alive" and stutters without a perfect connection;
 * she wants to watch a stream for 8-9 hours, watch only (no chat, not counted as a viewer), at lower
 * resolutions, 24-30 fps at most, with an audio-first mode, the encoder doing more work where it can.
 *
 * How:
 *   address   The stream's playback address is only on the channel's own Kick page. The server's Alchemy
 *             browser opens that page in a hidden tab (about:blank#alchemy-quiet: never shown to a viewer),
 *             reads the page's own channel data and closes the tab. No video or audio goes through Alchemy.
 *             Yukimi allowed this step herself (scripts/kick-stream-probe.js is the same read, for tests).
 *   stream    ffmpeg pulls one rendition from Kick's video servers and writes HLS (4 s pieces, the newest
 *             fifteen kept: a minute, so the player can sit ~20 s behind with a reserve to ride out gaps) into .cache/videos-live/<id>/, which the phone plays from /api/videos/live/<id>/.
 *   modes     pass-through of Kick's own 480p / 360p / 160p (no encoding: next to no processor time),
 *             hardware re-encodes at 30 fps (720p, 540p), careful software encodes at a low bitrate
 *             ("Enhanced": about 1.7-1.9 of this server's 8 threads, measured), and Audio First (one picture
 *             a second with full sound). Heavier high-effort encodes belong on a GPU worker, not here.
 *   life      A session lives while its pieces are being fetched: 45 s without a request ends it and
 *             removes its files. When ffmpeg stops (the source hiccuped, the address ran out) and someone is
 *             still watching, it is started again with a fresh address; when the channel went offline the
 *             session ends. One timer runs only while a session exists.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = process.env.VIDEOS_LIVE_DIR || path.join(__dirname, '..', '.cache', 'videos-live');
const CDP_PORT = Math.max(0, Number(process.env.ALCHEMY_CDP_PORT || 9339) || 0);
const FFMPEG = process.env.VIDEOS_FFMPEG || 'ffmpeg';
const VAAPI_DEVICE = process.env.VIDEOS_VAAPI_DEVICE || '/dev/dri/renderD128';
const SLUG = /^[a-z0-9_-]{2,40}$/;
const FILE = /^(index\.m3u8|s\d{1,7}\.ts)$/;
const IDLE_MS = 45000;
const READY_MS = 30000;
const ADDRESS_TTL = 5 * 60000;
const MAX_SESSIONS = 2;
const MAX_RESTARTS = 40;
const SEGMENT_S = 4;

class RelayError extends Error {
    constructor(message, code) { super(message); this.code = code || 'VIDEOS_RELAY'; }
}

const audio = (kbit) => ['-c:a', 'aac', '-b:a', `${kbit}k`, '-ac', '2'];
const x264 = (h, kbit, preset, fps = 30) => ['-vf', `fps=${fps},scale=-2:${h}:flags=lanczos`, '-c:v', 'libx264', '-preset', preset, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-b:v', `${kbit}k`, '-maxrate', `${Math.round(kbit * 1.3)}k`, '-bufsize', `${kbit * 3}k`, '-g', String(fps * SEGMENT_S), '-keyint_min', String(fps * SEGMENT_S), '-sc_threshold', '0', ...audio(96)];
const vaapi = (h, kbit) => ['-vf', `fps=30,format=nv12,hwupload,scale_vaapi=w=-2:h=${h}`, '-c:v', 'h264_vaapi', '-b:v', `${kbit}k`, '-maxrate', `${Math.round(kbit * 1.3)}k`, '-g', String(30 * SEGMENT_S), ...audio(96)];

// source: the height of Kick's rendition to pull. copy: no encoding. kbit: what the phone downloads, about.
const MODES = [
    { id: '480', label: '480p', note: 'Kick\'s own, about 1.4 Mbit/s', source: 480, copy: true, kbit: 1430 },
    { id: '360', label: '360p', note: 'Kick\'s own, about 0.6 Mbit/s', source: 360, copy: true, kbit: 630 },
    { id: '160', label: '160p', note: 'Kick\'s own, about 0.2 Mbit/s', source: 160, copy: true, kbit: 230 },
    { id: 'hw720', label: '720p at 30 fps', note: 'Re-encoded by the server, about 1.9 Mbit/s', source: 720, kbit: 1900, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(720, 1800) },
    { id: 'hw540', label: '540p at 30 fps', note: 'Re-encoded by the server, about 1.2 Mbit/s', source: 720, kbit: 1200, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(540, 1100) },
    { id: 'e480', label: '480p Enhanced', note: 'Careful encode, about 0.9 Mbit/s', source: 480, kbit: 900, heavy: true, args: x264(480, 800, 'medium') },
    { id: 'e360', label: '360p Enhanced', note: 'Careful encode, about 0.5 Mbit/s', source: 480, kbit: 500, heavy: true, args: x264(360, 400, 'slow') },
    { id: 'audio', label: 'Audio First', note: 'One picture a second, full sound, about 0.2 Mbit/s', source: 360, kbit: 200,
        // zerolatency: at one picture a second the encoder's look-ahead would hold the stream back ~20 s
        args: ['-vf', 'fps=1,scale=-2:360', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'zerolatency', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '30', '-g', String(SEGMENT_S), '-keyint_min', String(SEGMENT_S), '-sc_threshold', '0', ...audio(96)] }
];
const modeById = (id) => MODES.find((m) => m.id === id) || null;
const modesView = () => MODES.map((m) => ({ id: m.id, label: m.label, note: m.note, kbit: m.kbit, heavy: !!m.heavy }));

let allowed = () => true; // (slug) => is this a channel on the program's list
let hooks = { address: null, spawn: null }; // tests stand in for the browser and ffmpeg
const sessions = new Map(); // id -> session
const addresses = new Map(); // slug -> { at, url }
let timer = null;

function bind(opts = {}) {
    if (typeof opts.allowed === 'function') allowed = opts.allowed;
    // files of a session that did not end cleanly (a restart mid-stream)
    fs.promises.rm(ROOT, { recursive: true, force: true }).catch(() => {});
    return module.exports;
}

// ------------------------------------------------------------------------------------------ the address

function cdpVersion() {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/version', timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => { try { resolve(JSON.parse(body).webSocketDebuggerUrl); } catch (_) { reject(new RelayError('The server\'s browser is not running', 'ALCHEMY_OFFLINE')); } });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => reject(new RelayError('The server\'s browser is not running', 'ALCHEMY_OFFLINE')));
    });
}

/** The channel's page in a hidden tab: { live, playback } from the page's own channel data. */
async function readChannelPage(slug) {
    const WebSocket = require('ws');
    const ws = new WebSocket(await cdpVersion(), { perMessageDeflate: false });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', () => reject(new RelayError('The server\'s browser is not running', 'ALCHEMY_OFFLINE'))); });
    let next = 1;
    const waiting = new Map();
    ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch (_) { return; }
        const w = m.id != null && waiting.get(m.id);
        if (!w) return;
        waiting.delete(m.id);
        if (m.error) w.fail(new Error(m.error.message || 'browser error')); else w.ok(m.result || {});
    });
    ws.on('close', () => { for (const w of waiting.values()) w.fail(new RelayError('The server\'s browser went away', 'ALCHEMY_OFFLINE')); waiting.clear(); });
    const send = (method, params, sessionId) => new Promise((ok, fail) => {
        const id = next++;
        waiting.set(id, { ok, fail });
        ws.send(JSON.stringify(Object.assign({ id, method, params: params || {} }, sessionId ? { sessionId } : {})));
    });
    const expression = `(async () => {
        if (location.hostname !== 'kick.com' || document.readyState === 'loading') return null;
        try {
            const r = await fetch('/api/v2/channels/${slug}', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
            if (r.status === 404) return JSON.stringify({ missing: true });
            const j = await r.json();
            return JSON.stringify({ live: !!(j && j.livestream), playback: (j && j.playback_url) || '' });
        } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
    })()`;
    let targetId = null;
    try {
        let target;
        try { target = await send('Target.createTarget', { url: 'about:blank#alchemy-quiet', background: true, hidden: true }); } catch (_) { target = await send('Target.createTarget', { url: 'about:blank#alchemy-quiet', background: true }); }
        targetId = target.targetId;
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        await send('Page.navigate', { url: `https://kick.com/${slug}` }, sessionId);
        const started = Date.now();
        while (Date.now() - started < 30000) {
            await new Promise((r) => setTimeout(r, 700));
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId).catch(() => null);
            const value = r && r.result && r.result.value;
            if (!value) continue;
            const j = JSON.parse(value);
            if (j.error) continue; // the page was still settling: once more
            return j;
        }
        throw new RelayError('Kick\'s page did not load in the server\'s browser', 'KICK_PAGE');
    } finally {
        if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {});
        try { ws.close(); } catch (_) { /* gone */ }
    }
}

async function playbackAddress(slug, fresh) {
    const held = addresses.get(slug);
    if (held && !fresh && Date.now() - held.at < ADDRESS_TTL) return held.url;
    const r = await (hooks.address || readChannelPage)(slug);
    if (r.missing) throw new RelayError('Kick has no channel by that name', 'KICK_NOT_FOUND');
    if (!r.live || !/^https:\/\/[\w.-]+\//.test(String(r.playback || ''))) { addresses.delete(slug); throw new RelayError('That channel is not live right now', 'KICK_OFFLINE'); }
    addresses.set(slug, { at: Date.now(), url: r.playback });
    return r.playback;
}

/** The stream's renditions from its master playlist: [{ height, fps, kbit, url }], best first. */
function parseMaster(text, base) {
    const out = [];
    const lines = String(text || '').split('\n');
    lines.forEach((line, i) => {
        if (!line.startsWith('#EXT-X-STREAM-INF')) return;
        const attr = (k) => (new RegExp(`${k}=("([^"]*)"|[^,]*)`).exec(line) || [])[1] || '';
        const height = Number((/x(\d+)/.exec(attr('RESOLUTION')) || [])[1]) || 0;
        const next = (lines[i + 1] || '').trim();
        if (!height || !next || next.startsWith('#')) return;
        let url;
        try { url = new URL(next, base).toString(); } catch (_) { return; }
        out.push({ height, fps: Math.round(Number(attr('FRAME-RATE')) || 0), kbit: Math.round((Number(attr('BANDWIDTH')) || 0) / 1000), url });
    });
    return out.sort((a, b) => b.height - a.height || b.kbit - a.kbit);
}

/** The rendition to pull for a mode: the wanted height, else the next one down, else the smallest there is. */
function pickVariant(variants, height) {
    if (!variants.length) return null;
    return variants.find((v) => v.height === height) || variants.find((v) => v.height < height) || variants[variants.length - 1];
}

async function variantFor(slug, mode, fresh) {
    const address = await playbackAddress(slug, fresh);
    let res;
    try { res = await fetch(address, { signal: AbortSignal.timeout(12000) }); } catch (e) { throw new RelayError(`Kick's video servers could not be reached (${e.message})`, 'KICK_STREAM'); }
    if (res.status !== 200) {
        addresses.delete(slug);
        throw new RelayError(res.status === 404 || res.status === 403 ? 'That channel is not live right now' : `Kick's video servers answered ${res.status}`, res.status === 404 || res.status === 403 ? 'KICK_OFFLINE' : 'KICK_STREAM');
    }
    const v = pickVariant(parseMaster(await res.text(), address), mode.source);
    if (!v) throw new RelayError('The stream has no rendition to pull', 'KICK_STREAM');
    return v;
}

// ------------------------------------------------------------------------------------------ ffmpeg

function ffmpegArgs(mode, inputUrl, dir) {
    return ['-hide_banner', '-loglevel', 'error', '-nostdin', ...(mode.pre || []), '-i', inputUrl,
        ...(mode.copy ? ['-c', 'copy'] : mode.args),
        '-f', 'hls', '-hls_time', String(SEGMENT_S), '-hls_list_size', '15',
        '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments+temp_file+discont_start',
        '-hls_segment_filename', path.join(dir, 's%05d.ts'), path.join(dir, 'index.m3u8')];
}

function run(session, variant) {
    const args = ffmpegArgs(session.mode, variant.url, session.dir);
    // a notch below the server's own work: an encode must not starve Dreamscape
    const child = hooks.spawn ? hooks.spawn(args, session) : spawn('nice', ['-n', '6', FFMPEG, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    session.child = child;
    session.source = { height: variant.height, fps: variant.fps, kbit: variant.kbit };
    let err = '';
    if (child.stderr) child.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    child.on('error', (e) => { err = `${err}\n${e.message}`; });
    child.on('close', () => {
        if (session.child !== child) return;
        session.child = null;
        if (session.stopped) return;
        void again(session, err.trim().split('\n').slice(-1)[0] || '');
    });
}

/** ffmpeg stopped while the session was wanted: a fresh address and another run, or the end when the channel is offline. */
async function again(session, why) {
    if (Date.now() - session.lastHit > IDLE_MS || session.restarts >= MAX_RESTARTS) { await stop(session.id, why || 'stopped'); return; }
    session.restarts += 1;
    session.state = 'restarting';
    await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * session.restarts)));
    if (session.stopped) return;
    try {
        run(session, await variantFor(session.slug, session.mode, true));
        session.state = 'live';
    } catch (e) {
        session.state = e.code === 'KICK_OFFLINE' ? 'ended' : 'error';
        session.error = e.message;
        // the phone is told by state(); the files go once it stops asking
        if (e.code !== 'KICK_OFFLINE' && !session.stopped) setTimeout(() => { if (!session.stopped && !session.child) void again(session, e.message); }, 10000);
    }
}

async function ready(session) {
    const started = Date.now();
    while (Date.now() - started < READY_MS && !session.stopped) {
        try {
            const text = await fs.promises.readFile(path.join(session.dir, 'index.m3u8'), 'utf8');
            if ((text.match(/#EXTINF/g) || []).length >= 2) return true;
        } catch (_) { /* not written yet */ }
        if (!session.child && session.state !== 'restarting') return false;
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

function watch() {
    if (timer || !sessions.size) return;
    timer = setInterval(() => {
        const now = Date.now();
        for (const s of sessions.values()) if (now - s.lastHit > IDLE_MS) void stop(s.id, 'nobody watching');
        if (!sessions.size) { clearInterval(timer); timer = null; }
    }, 15000);
    if (timer.unref) timer.unref();
}

const view = (s) => ({ id: s.id, slug: s.slug, mode: s.mode.id, state: s.state, error: s.error || '', url: `/api/videos/live/${s.id}/index.m3u8`, source: s.source || null, restarts: s.restarts, startedAt: s.startedAt });

/** Start watching a channel in a mode (or take the session already running it): resolves once the phone can play. */
async function start(slugIn, modeId) {
    const slug = String(slugIn || '').toLowerCase().replace(/^kick:/, '');
    const mode = modeById(String(modeId || '')) || MODES[0];
    if (!SLUG.test(slug) || !allowed(slug)) throw new RelayError('Add the channel under Channels > Kick first', 'KICK_NOT_LISTED');
    for (const s of sessions.values()) {
        if (s.slug === slug && s.mode.id === mode.id && !s.stopped && s.state !== 'ended' && s.state !== 'error') { s.lastHit = Date.now(); if (s.starting) await s.starting; return view(s); }
    }
    // first that there is a stream to pull: a channel that is not live must not push a running stream out
    const variant = await variantFor(slug, mode, false);
    // another quality of the same channel, or an older stream past the limit, makes room
    for (const s of [...sessions.values()]) if (s.slug === slug) await stop(s.id, 'replaced');
    while (sessions.size >= MAX_SESSIONS) await stop([...sessions.values()].sort((a, b) => a.lastHit - b.lastHit)[0].id, 'replaced');
    const id = crypto.randomBytes(12).toString('hex');
    const session = { id, slug, mode, dir: path.join(ROOT, id), state: 'starting', error: '', child: null, stopped: false, restarts: 0, startedAt: Date.now(), lastHit: Date.now(), source: null, starting: null };
    sessions.set(id, session);
    watch();
    session.starting = (async () => {
        await fs.promises.mkdir(session.dir, { recursive: true });
        run(session, variant);
        if (!(await ready(session))) throw new RelayError(session.error || 'The stream did not start', 'KICK_STREAM');
        session.state = 'live';
    })();
    try {
        await session.starting;
    } catch (e) {
        await stop(id, e.message);
        throw e;
    } finally {
        session.starting = null;
    }
    return view(session);
}

async function stop(id, _why) {
    const s = sessions.get(String(id || ''));
    if (!s) return false;
    s.stopped = true;
    sessions.delete(s.id);
    if (s.child) { try { s.child.kill('SIGTERM'); } catch (_) { /* gone */ } }
    await fs.promises.rm(s.dir, { recursive: true, force: true }).catch(() => {});
    if (!sessions.size && timer) { clearInterval(timer); timer = null; }
    return true;
}

function state(id) {
    const s = sessions.get(String(id || ''));
    if (!s) return { id: String(id || ''), state: 'gone' };
    s.lastHit = Date.now();
    return view(s);
}

// ------------------------------------------------------------------------------------------ the phone's player reads here

function mount(app, authMiddleware) {
    app.get('/api/videos/live/:id/:file', authMiddleware, (req, res) => {
        const s = sessions.get(String(req.params.id || ''));
        const file = String(req.params.file || '');
        if (!s || !FILE.test(file)) { res.status(404).end(); return; }
        s.lastHit = Date.now();
        const playlist = file.endsWith('.m3u8');
        res.sendFile(path.join(s.dir, file), {
            dotfiles: 'allow', // the files live under .cache
            headers: {
                'Content-Type': playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
                // the live list changes every piece and must never be reused; a piece never changes
                'Cache-Control': playlist ? 'no-store' : 'private, max-age=120, immutable'
            }
        }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
    });
}

module.exports = {
    bind, mount, start, stop, state, modes: modesView, RelayError,
    _test: { parseMaster, pickVariant, ffmpegArgs, MODES, sessions, setHooks(h) { hooks = Object.assign({ address: null, spawn: null }, h); }, reset() { for (const s of sessions.values()) s.stopped = true; sessions.clear(); addresses.clear(); if (timer) { clearInterval(timer); timer = null; } } }
};
