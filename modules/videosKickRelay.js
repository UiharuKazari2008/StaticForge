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
 *             hardware re-encodes of the big pictures at 30, 24 or 15 fps (1080p, 720p; 540p at 30), careful software encodes at a low bitrate
 *             ("Enhanced": about 1.7-1.9 of this server's 8 threads, measured), and Audio First (one picture
 *             a second with full sound). Heavier high-effort encodes belong on a GPU worker, not here.
 *   life      A session lives while its pieces are being fetched: 45 s without a request ends it and
 *             removes its files. When ffmpeg stops (the source hiccuped, the address ran out) and someone is
 *             still watching, it is started again with a fresh address; when the channel went offline the
 *             session ends. One timer runs only while a session exists.
 *   record    The phone's player keeps asking for the same address with the screen off, so the session's
 *             address must outlive the session (#1365). Each session leaves a small record on disk
 *             (modules/videosRelayStore.js: channel, quality, start time, last request). The idle end stays
 *             45 s (encoder and files go), but it no longer costs the stream: it and a server restart keep the
 *             record. Only the viewer ends a stream for good (stop, another quality of the channel, a channel
 *             taken off the list), and that removes it.
 *   revive    When the playlist of an address that has no session is asked for and its record is there, the
 *             session is started again in the background under the SAME address and the player is told to
 *             come back in a few seconds (503 with Retry-After): the request never waits for ffmpeg. If the
 *             channel already runs in another session, that one answers for the old address and nothing is
 *             started. Only the playlist revives, never a piece. A revive never pushes a running stream out
 *             and is bounded so Kick is never hammered: at least 20 s between tries for one address, doubling
 *             while the revived stream never plays (up to 5 minutes), and at most 5 tries in 10 minutes. A
 *             channel that is offline keeps its record and is tried again within those bounds. The new
 *             encoder starts its piece numbers past anything the earlier run wrote, because pieces are cached
 *             by the player under their address.
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
const vaapi = (h, kbit, fps = 30) => ['-vf', `fps=${fps},format=nv12,hwupload,scale_vaapi=w=-2:h=${h}`, '-c:v', 'h264_vaapi', '-b:v', `${kbit}k`, '-maxrate', `${Math.round(kbit * 1.3)}k`, '-g', String(fps * SEGMENT_S), ...audio(96)];

// source: the height of Kick's rendition to pull. copy: no encoding. kbit: what the phone downloads, about.
const MODES = [
    // the big pictures at a calmer frame rate (Yukimi: 1080p and 720p at lower fps): hardware re-encodes from
    // Kick's 60 fps renditions; fewer pictures a second is what brings the data rate down
    { id: 'hw1080', group: '1080p', short: '30 fps', label: '1080p at 30 fps', note: 'Re-encoded by the server, about 3.7 Mbit/s', source: 1080, kbit: 3700, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(1080, 3500, 30) },
    { id: 'hw1080f24', group: '1080p', short: '24 fps', label: '1080p at 24 fps', note: 'Re-encoded, about 3 Mbit/s', source: 1080, kbit: 3000, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(1080, 2800, 24) },
    { id: 'hw1080f15', group: '1080p', short: '15 fps', label: '1080p at 15 fps', note: 'Re-encoded, about 2.1 Mbit/s', source: 1080, kbit: 2100, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(1080, 2000, 15) },
    { id: 'hw720', group: '720p', short: '30 fps', label: '720p at 30 fps', note: 'Re-encoded by the server, about 1.9 Mbit/s', source: 720, kbit: 1900, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(720, 1800, 30) },
    { id: 'hw720f24', group: '720p', short: '24 fps', label: '720p at 24 fps', note: 'Re-encoded, about 1.6 Mbit/s', source: 720, kbit: 1600, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(720, 1500, 24) },
    { id: 'hw720f15', group: '720p', short: '15 fps', label: '720p at 15 fps', note: 'Re-encoded, about 1.1 Mbit/s', source: 720, kbit: 1100, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(720, 1000, 15) },
    { id: 'hw540', group: 'More', short: '540p', label: '540p at 30 fps', note: 'Re-encoded by the server, about 1.2 Mbit/s', source: 720, kbit: 1200, pre: ['-vaapi_device', VAAPI_DEVICE], args: vaapi(540, 1100) },
    { id: '480', group: '', short: '480p', label: '480p', note: 'Kick\'s own, about 1.4 Mbit/s', source: 480, copy: true, kbit: 1430 },
    { id: '360', group: '', short: '360p', label: '360p', note: 'Kick\'s own, about 0.6 Mbit/s', source: 360, copy: true, kbit: 630 },
    { id: '160', group: 'More', short: '160p', label: '160p', note: 'Kick\'s own, about 0.2 Mbit/s', source: 160, copy: true, kbit: 230 },
    { id: 'e480', group: 'More', short: '480p Enhanced', label: '480p Enhanced', note: 'Careful encode, about 0.9 Mbit/s', source: 480, kbit: 900, heavy: true, args: x264(480, 800, 'medium') },
    { id: 'e360', group: 'More', short: '360p Enhanced', label: '360p Enhanced', note: 'Careful encode, about 0.5 Mbit/s', source: 480, kbit: 500, heavy: true, args: x264(360, 400, 'slow') },
    { id: 'audio', group: '', short: 'Audio First', label: 'Audio First', note: 'One picture a second, full sound, about 0.2 Mbit/s', source: 360, kbit: 200,
        // zerolatency: at one picture a second the encoder's look-ahead would hold the stream back ~20 s
        args: ['-vf', 'fps=1,scale=-2:360', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'zerolatency', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '30', '-g', String(SEGMENT_S), '-keyint_min', String(SEGMENT_S), '-sc_threshold', '0', ...audio(96)] }
];
const DEFAULT_MODE = '480';
const modeById = (id) => MODES.find((m) => m.id === id) || null;
// group / short: how the program's Quality list is laid out (a short list with 1080p, 720p and More opening sub-lists)
const modesView = () => MODES.map((m) => ({ id: m.id, label: m.label, note: m.note, kbit: m.kbit, heavy: !!m.heavy, group: m.group || '', short: m.short || m.label }));

let allowed = () => true; // (slug) => is this a channel on the program's list
let hooks = { address: null, spawn: null }; // tests stand in for the browser and ffmpeg
const sessions = new Map(); // id -> session
const addresses = new Map(); // slug -> { at, url }
const aliases = new Map(); // an old address (session id) -> the running session of the same channel that answers for it
const reviving = new Set(); // ids being started again: one in flight per id
const idleEnded = new Set(); // ids whose session ended for lack of viewers in this run (the log line says idle, else restart)
let store = null; // the session records (modules/videosRelayStore.js), opened on first use
let budget = null; // how often a gone session may be started again (per id)
let disposed = false; // this version was reloaded away: nothing it has in flight may start a session
let timer = null;
let wiping = Promise.resolve(); // bind() clearing the folder: no session folder is made before it is done
const RETRY_FULL_S = 30;

const records = () => store || (store = require('./videosRelayStore').open(process.env.VIDEOS_LIVE_STORE || path.join(__dirname, '..', '.cache', 'videos-live-sessions.json')));
const revives = () => budget || (budget = new (require('./videosRelayStore').ReviveBudget)());
/** The record, the budget entry and the aliases of an address that is over for good. */
function dropRecord(id) {
    records().remove(id);
    revives().forget(id);
    aliases.delete(id);
    idleEnded.delete(id);
}

function bind(opts = {}) {
    if (typeof opts.allowed === 'function') allowed = opts.allowed;
    // files of a session that did not end cleanly (a restart mid-stream)
    wiping = fs.promises.rm(ROOT, { recursive: true, force: true }).catch(() => {});
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

// startNumber: only for a session started again under its old address (its pieces are cached by the player by
// name, so a new encoder must never write s00000.ts again); with append_list a restart in the same session
// still continues after the last piece (tested with the real ffmpeg)
function ffmpegArgs(mode, inputUrl, dir, startNumber) {
    return ['-hide_banner', '-loglevel', 'error', '-nostdin', ...(mode.pre || []), '-i', inputUrl,
        ...(mode.copy ? ['-c', 'copy'] : mode.args),
        '-f', 'hls', '-hls_time', String(SEGMENT_S), '-hls_list_size', '15',
        '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments+temp_file+discont_start',
        ...(startNumber > 0 ? ['-start_number', String(startNumber)] : []),
        '-hls_segment_filename', path.join(dir, 's%05d.ts'), path.join(dir, 'index.m3u8')];
}

function run(session, variant) {
    const args = ffmpegArgs(session.mode, variant.url, session.dir, session.startNumber);
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
    // nobody is asking any more (or the source never came back): the stream's address stays good, see revive()
    if (Date.now() - session.lastHit > IDLE_MS || session.restarts >= MAX_RESTARTS) { await stop(session.id, why || 'stopped', { keep: true, idle: true }); return; }
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

// the idle end: its record stays, so the player's next ask for the playlist starts the stream again (see revive)
function sweep() {
    const now = Date.now();
    for (const s of sessions.values()) if (now - s.lastHit > IDLE_MS) void stop(s.id, 'nobody watching', { keep: true, idle: true });
    if (!sessions.size && timer) { clearInterval(timer); timer = null; }
}

function watch() {
    if (timer || !sessions.size) return;
    timer = setInterval(sweep, 15000);
    if (timer.unref) timer.unref();
}

const view = (s) => ({ id: s.id, slug: s.slug, mode: s.mode.id, state: s.state, error: s.error || '', url: `/api/videos/live/${s.id}/index.m3u8`, source: s.source || null, restarts: s.restarts, startedAt: s.startedAt });

/** A running session of the channel (any quality), or null. */
function runningFor(slug) {
    for (const s of sessions.values()) if (s.slug === slug && !s.stopped && s.state !== 'ended' && s.state !== 'error') return s;
    return null;
}

/** A session answers for its address: its own id, or an old address of the same channel (see revive). */
function sessionFor(id) {
    const s = sessions.get(id);
    if (s) return s;
    const target = aliases.get(id);
    if (!target) return null;
    const t = sessions.get(target);
    if (t && !t.stopped) return t;
    aliases.delete(id);
    return null;
}

/** Somebody asked for the session (or its old address): it lives on, and so does its record. */
function hit(s, askedId) {
    s.lastHit = Date.now();
    records().touch(s.id, { lastHit: s.lastHit });
    if (askedId && askedId !== s.id) records().touch(askedId, { lastHit: s.lastHit });
}

function openSession(id, slug, mode, extra) {
    if (disposed) throw new RelayError('The server is reloading this part, try again in a moment', 'KICK_STREAM');
    const now = Date.now();
    const session = Object.assign({ id, slug, mode, dir: path.join(ROOT, id), state: 'starting', error: '', child: null, stopped: false, restarts: 0, startedAt: now, lastHit: now, source: null, starting: null }, extra);
    sessions.set(id, session);
    watch();
    return session;
}

/** The steps of a start that both a new session and a revived one share: folder, ffmpeg, the first pieces. Throws when it did not start. */
async function begin(session, variant) {
    session.starting = (async () => {
        await wiping;
        await fs.promises.mkdir(session.dir, { recursive: true });
        run(session, variant);
        if (!(await ready(session))) throw new RelayError(session.error || 'The stream did not start', 'KICK_STREAM');
        session.state = 'live';
    })();
    try {
        await session.starting;
    } finally {
        session.starting = null;
    }
}

/** The viewer chose a new quality of the channel: the addresses of the other qualities are dead for good. */
function dropOtherModes(slug, modeId) {
    for (const r of records().all()) if (r.slug === slug && r.mode !== modeId) dropRecord(r.id);
}

/** Start watching a channel in a mode (or take the session already running it): resolves once the phone can play. */
async function start(slugIn, modeId) {
    const slug = String(slugIn || '').toLowerCase().replace(/^kick:/, '');
    const mode = modeById(String(modeId || '')) || modeById(DEFAULT_MODE);
    if (!SLUG.test(slug) || !allowed(slug)) throw new RelayError('Add the channel under Channels > Kick first', 'KICK_NOT_LISTED');
    for (const s of sessions.values()) {
        if (s.slug === slug && s.mode.id === mode.id && !s.stopped && s.state !== 'ended' && s.state !== 'error') { hit(s); dropOtherModes(slug, mode.id); if (s.starting) await s.starting; return view(s); }
    }
    // first that there is a stream to pull: a channel that is not live must not push a running stream out
    const variant = await variantFor(slug, mode, false);
    // another quality of the same channel, or an older stream past the limit, makes room
    for (const s of [...sessions.values()]) if (s.slug === slug) await stop(s.id, 'replaced');
    while (sessions.size >= MAX_SESSIONS) await stop([...sessions.values()].sort((a, b) => a.lastHit - b.lastHit)[0].id, 'replaced');
    dropOtherModes(slug, mode.id);
    const id = crypto.randomBytes(12).toString('hex');
    const session = openSession(id, slug, mode, {});
    try {
        await begin(session, variant);
    } catch (e) {
        await stop(id, e.message);
        throw e;
    }
    if (sessions.get(id) === session) records().put(id, { slug, mode: mode.id, startedAt: session.startedAt, lastHit: session.lastHit });
    return view(session);
}

/**
 * Ends a session. The record of its address is removed unless opts.keep: only the idle ends keep it (nobody
 * asked for 45 s, or the source never came back), so that the player's next ask for the playlist can start the
 * stream again. A stop that is not for the idle end (the viewer, another quality, a failed start) is for good.
 */
async function stop(id, _why, opts) {
    const key = String(id || '');
    const keep = !!(opts && opts.keep);
    const s = sessionFor(key);
    if (!keep) {
        // the addresses that stood in for this session end with it
        for (const [old, target] of [...aliases]) if (s && target === s.id) dropRecord(old);
        dropRecord(key);
        if (s) dropRecord(s.id);
    }
    if (!s) return false;
    for (const [old, target] of [...aliases]) if (target === s.id) aliases.delete(old);
    s.stopped = true;
    sessions.delete(s.id);
    if (keep && opts.idle) {
        idleEnded.add(s.id);
        if (idleEnded.size > 64) idleEnded.delete(idleEnded.values().next().value);
    }
    if (s.child) { try { s.child.kill('SIGTERM'); } catch (_) { /* gone */ } }
    await fs.promises.rm(s.dir, { recursive: true, force: true }).catch(() => {});
    if (!sessions.size && timer) { clearInterval(timer); timer = null; }
    return true;
}

function state(id) {
    const key = String(id || '');
    const s = sessionFor(key);
    if (!s) return { id: key, state: 'gone' };
    hit(s, key);
    return view(s);
}

// ------------------------------------------------------------------------------------------ a gone session comes back

/**
 * The playlist of an address with no session was asked for and its record is there (the server restarted, or the
 * viewer's phone was away past the idle end): the same address plays again. Decides at once and never throws:
 *   { session }  a session answers for the address now (the channel already runs: no budget, no Kick request)
 *   { wait }     come back in that many seconds (503): starting in the background, or not allowed yet
 *   { gone }     the address is over (the channel left the list, the record is bad): 404
 */
function revive(id, record) {
    try {
        if (reviving.has(id)) return { wait: 3 };
        const mode = modeById(String((record && record.mode) || ''));
        const slug = String((record && record.slug) || '');
        if (!mode || !SLUG.test(slug) || !allowed(slug)) { dropRecord(id); return { gone: true }; }
        const running = runningFor(slug);
        if (running) { aliases.set(id, running.id); return { session: running }; }
        // a revive never pushes out a running stream
        if (sessions.size >= MAX_SESSIONS) return { wait: RETRY_FULL_S };
        const now = Date.now();
        if (!revives().take(id, now)) return { wait: Math.min(300, Math.max(1, Math.ceil(revives().waitMs(id, now) / 1000))) };
        reviving.add(id);
        void reviveRun(id, record, mode, idleEnded.has(id) ? 'idle' : 'restart');
        return { wait: 3 };
    } catch (e) {
        console.warn(`[videos] kick: a stream could not be started again (${e.message})`);
        return { wait: RETRY_FULL_S };
    }
}

/** The background half of revive(): the same steps as start(), under the old id; a failure never reaches anybody. */
async function reviveRun(id, record, mode, why) {
    const slug = String(record.slug);
    let session = null;
    try {
        const variant = await variantFor(slug, mode, false);
        // the viewer may have ended the stream while the address was being read: an ended one stays ended
        if (disposed || !records().get(id)) return;
        const running = runningFor(slug);
        if (running) { aliases.set(id, running.id); return; } // the viewer started the channel meanwhile
        if (sessions.size >= MAX_SESSIONS) throw new RelayError('There is no room for another stream just now', 'RELAY_FULL');
        // pieces are made in real time, so this is past every number the earlier run reached under this address
        const startedAt = Number(record.startedAt) || Date.now();
        const startNumber = Math.min(9999000, Math.max(8, Math.floor((Date.now() - startedAt) / (SEGMENT_S * 1000)) + 8));
        session = openSession(id, slug, mode, { startedAt, startNumber, revive: { served: 0, proven: false } });
        await begin(session, variant);
        idleEnded.delete(id);
        console.log(`[videos] kick ${slug}: session started again (${why})`);
    } catch (e) {
        const over = e.code === 'KICK_NOT_FOUND' || e.code === 'KICK_NOT_LISTED';
        console.warn(`[videos] kick ${slug}: the stream could not be started again (${e.message})`);
        // the budget's doubling gap bounds the next try; a channel that is gone is over for good
        if (session) await stop(id, e.message, { keep: !over });
        if (over) dropRecord(id);
    } finally {
        reviving.delete(id);
    }
}

/** A revived stream that served its pieces has come to play: the next revive's gap starts over. */
function pieceServed(s) {
    if (!s.revive || s.revive.proven) return;
    s.revive.served += 1;
    if (s.revive.served >= 5) { s.revive.proven = true; revives().proven(s.id); }
}

// ------------------------------------------------------------------------------------------ the phone's player reads here

function retryLater(res, seconds) {
    res.set('Retry-After', String(Math.min(300, Math.max(1, Math.round(seconds)))));
    res.set('Cache-Control', 'no-store');
    res.status(503).end();
}

function serve(req, res) {
    const id = String(req.params.id || '');
    const file = String(req.params.file || '');
    if (!FILE.test(file)) { res.status(404).end(); return; }
    const playlist = file.endsWith('.m3u8');
    let s = sessionFor(id);
    if (!s) {
        // only the playlist brings a stream back, never a piece
        let record = null;
        if (playlist) { try { record = records().get(id); } catch (_) { record = null; } }
        if (!record) { res.status(404).end(); return; }
        const r = revive(id, record);
        if (r.gone) { res.status(404).end(); return; }
        if (!r.session) { retryLater(res, r.wait); return; }
        s = r.session;
    }
    hit(s, id);
    // a session still starting has no list worth sending yet: the player asks again
    if (playlist && s.starting) { retryLater(res, 3); return; }
    res.sendFile(path.join(s.dir, file), {
        dotfiles: 'allow', // the files live under .cache
        headers: {
            'Content-Type': playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
            // the live list changes every piece and must never be reused; a piece never changes
            'Cache-Control': playlist ? 'no-store' : 'private, max-age=120, immutable'
        }
    }, (err) => {
        if (err) { if (!res.headersSent) res.status(404).end(); return; }
        if (!playlist) pieceServed(s);
    });
}

function mount(app, authMiddleware) {
    // late-bound: a reload of this module replaces serve() without a new route
    app.get('/api/videos/live/:id/:file', authMiddleware, (req, res) => module.exports.serve(req, res));
}

module.exports = {
    bind, mount, serve, start, stop, state, modes: modesView, RelayError,
    _test: {
        parseMaster, pickVariant, ffmpegArgs, MODES, sessions, aliases, reviving, IDLE_MS, sweep,
        setHooks(h) { hooks = Object.assign({ address: null, spawn: null }, h); },
        setStore(s) { store = s; },
        setBudget(b) { budget = b; },
        dispose: () => hotDispose(),
        accept: (st) => hotAccept(st),
        reset() {
            for (const s of sessions.values()) s.stopped = true;
            sessions.clear(); aliases.clear(); reviving.clear(); idleEnded.clear(); addresses.clear();
            store = null; budget = null; disposed = false;
            if (timer) { clearInterval(timer); timer = null; }
        }
    }
};

// Reload without a restart (#1292, docs/server/hot-reload.md): a reload ends every session the way a restart would. The records
// stay, so the next ask for a playlist starts the stream again under its address. The route is late-bound (serve above).
function hotDispose() {
    disposed = true;
    for (const s of sessions.values()) {
        s.stopped = true;
        if (s.child) { try { s.child.kill('SIGTERM'); } catch (_) { /* gone */ } }
        // at once, not later: a revive of the same address right after the reload must not find its folder removed under it
        try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (_) { /* gone */ }
    }
    sessions.clear(); aliases.clear(); reviving.clear(); idleEnded.clear(); addresses.clear();
    if (timer) { clearInterval(timer); timer = null; }
    if (store) store.flush();
    return { allowed };
}

function hotAccept(st) {
    disposed = false; // also when the old version is re-armed by a rollback
    if (st && typeof st.allowed === 'function') allowed = st.allowed;
}

require('./hotReload').mark(module, { dispose: hotDispose, accept: hotAccept });
