/**
 * Melaton Videos: a YouTube video through the server (Yozora #920). Yukimi, Nov 18 2026: "for youtube are you
 * performing the transcording on the server like we should" ... "yes use yt-dlp with autoupdate".
 *
 * yt-dlp (github.com/yt-dlp/yt-dlp, its own release program kept in .cache/yt-dlp and updated by itself) names
 * the video's files at the wanted size and downloads them; ffmpeg joins picture and sound into HLS pieces the program's player
 * reads from /api/videos/yt/<id>/. H.264 with AAC is taken as it is (no encoding: the smaller size is YouTube's
 * own rendition), so a video costs the server almost nothing; "Audio First" takes the sound alone.
 *
 * Bounds, on purpose:
 *   - public videos only. No account is used: the Google sign-in in the server's browser is never read here
 *     (a session shared between two clients is signed out by Google). A video for members, with an age gate, or
 *     one YouTube will not hand to a server without a sign-in fails here, and the program falls back to
 *     YouTube's own embedded player. Nothing here works around a refusal.
 *   - not live streams (they are YouTube's player's), and nothing longer than 8 hours.
 *
 * A session is one video in one quality from one place (`at`, seconds): the player asks again to move outside
 * what is written, or to change quality. Files go 20 minutes after the last request, or on stop.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const ROOT = process.env.VIDEOS_YT_DIR || path.join(__dirname, '..', '.cache', 'videos-yt');
const TOOL_DIR = process.env.VIDEOS_YTDLP_DIR || path.join(__dirname, '..', '.cache', 'yt-dlp');
const TOOL = path.join(TOOL_DIR, 'yt-dlp');
const TOOL_URL = process.env.VIDEOS_YTDLP_URL || 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const VIDEO_ID = /^[\w-]{11}$/;
const FILE = /^(index\.m3u8|s\d{5}\.ts)$/;
const SEGMENT_S = 4;
const INFO_TTL = 30 * 60000; // YouTube's file addresses last hours; moving within a video or back to it asks yt-dlp once
const IDLE_MS = 20 * 60000;
const UPDATE_MS = 24 * 3600000;
const MAX_SESSIONS = 2;
const MAX_SECONDS = 8 * 3600;
const READY_MS = 45000;

const MODES = [
    { id: 'v1080', label: '1080p', height: 1080 },
    { id: 'v720', label: '720p', height: 720 },
    { id: 'v480', label: '480p', height: 480 },
    { id: 'v360', label: '360p', height: 360 },
    { id: 'v144', label: '144p', height: 144 },
    { id: 'vaudio', label: 'Audio First', height: 0 }
];
const DEFAULT_MODE = 'v480';
const modeById = (id) => MODES.find((m) => m.id === id) || null;
const modesView = () => MODES.map((m) => ({ id: m.id, label: m.label, short: m.label, group: '', kbit: 0 }));

class YtRelayError extends Error {
    constructor(message, code) { super(message); this.code = code || 'YT_RELAY'; }
}

const sessions = new Map();
let timer = null;
let hooks = { info: null, spawn: null };

// ------------------------------------------------------------------------------------------ yt-dlp, kept current

let toolBusy = null;
let updateBusy = null;
const stampFile = path.join(TOOL_DIR, 'checked');
const lastCheck = () => { try { return fs.statSync(stampFile).mtimeMs; } catch (_e) { return 0; } };
const stamp = () => { try { fs.writeFileSync(stampFile, new Date().toISOString()); } catch (_e) { /* next time */ } };

/** The program is there (fetched from its release page the first time). */
function ensureTool() {
    if (fs.existsSync(TOOL)) return Promise.resolve(TOOL);
    if (!toolBusy) {
        toolBusy = (async () => {
            await fs.promises.mkdir(TOOL_DIR, { recursive: true });
            const res = await fetch(TOOL_URL, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
            if (res.status !== 200) throw new YtRelayError(`yt-dlp could not be fetched (${res.status})`, 'YT_TOOL');
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 1024 * 1024) throw new YtRelayError('yt-dlp could not be fetched', 'YT_TOOL');
            await fs.promises.writeFile(`${TOOL}.tmp`, buf, { mode: 0o755 });
            await fs.promises.rename(`${TOOL}.tmp`, TOOL);
            stamp();
            return TOOL;
        })().finally(() => { toolBusy = null; });
    }
    return toolBusy;
}

/** yt-dlp updates itself (its own -U, from its release page): once a day, and at once when YouTube changed under it. */
function updateTool(force) {
    if (updateBusy) return updateBusy;
    if (!force && Date.now() - lastCheck() < UPDATE_MS) return Promise.resolve(false);
    if (force && Date.now() - lastCheck() < 30 * 60000) return Promise.resolve(false);
    updateBusy = new Promise((resolve) => {
        stamp();
        execFile(TOOL, ['-U'], { timeout: 180000 }, (err, stdout) => {
            const out = String(stdout || '');
            if (err) console.warn(`[videos] yt-dlp update: ${err.message.split('\n')[0]}`);
            else if (/Updated yt-dlp to/i.test(out)) console.log(`[videos] ${out.trim().split('\n').slice(-1)[0]}`);
            resolve(!err && /Updated yt-dlp to/i.test(out));
        });
    }).finally(() => { updateBusy = null; });
    return updateBusy;
}

/** The selector for a mode: H.264 picture at most that tall with AAC sound (what every phone plays, taken as it is). */
function formatFor(mode) {
    if (!mode.height) return 'ba[acodec^=mp4a]/ba';
    return `bv*[height<=${mode.height}][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<=${mode.height}][vcodec^=avc1]/bv*[height<=${mode.height}]+ba/b[height<=${mode.height}]`;
}

function askTool(id, mode) {
    return new Promise((resolve, reject) => {
        execFile(TOOL, ['--js-runtimes', 'node', '--no-playlist', '--no-warnings', '--no-cache-dir', '-J', '-f', formatFor(mode), `https://www.youtube.com/watch?v=${id}`],
            { timeout: 60000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) { reject(new YtRelayError(String(stderr || err.message).trim().split('\n').slice(-1)[0].replace(/^ERROR:\s*(\[[^\]]*\]\s*)?([\w-]{11}:\s*)?/, '').slice(0, 300) || 'yt-dlp failed', 'YT_REFUSED')); return; }
                try { resolve(JSON.parse(stdout)); } catch (_e) { reject(new YtRelayError('yt-dlp answered nothing usable', 'YT_REFUSED')); }
            });
    });
}

/** What to pull for a video in a mode: { title, duration, inputs: [{ url, headers }], copy, height, kbit }. */
const infoMemo = new Map(); // "<video> <mode>" -> { at, src }
async function info(id, mode) {
    if (hooks.info) return hooks.info(id, mode);
    const key = `${id} ${mode.id}`;
    const held = infoMemo.get(key);
    if (held && Date.now() - held.at < INFO_TTL) return held.src;
    const src = await readInfo(id, mode);
    infoMemo.forEach((v, k) => { if (Date.now() - v.at > INFO_TTL) infoMemo.delete(k); });
    infoMemo.set(key, { at: Date.now(), src });
    return src;
}
async function readInfo(id, mode) {
    await ensureTool();
    let d;
    try {
        d = await askTool(id, mode);
    } catch (e) {
        // YouTube changes often: a newer yt-dlp usually knows; one update and one more try
        if (!(await updateTool(true))) throw e;
        d = await askTool(id, mode);
    }
    void updateTool(false);
    if (d.is_live || d.live_status === 'is_live' || d.live_status === 'is_upcoming') throw new YtRelayError('A live stream plays in YouTube\'s own player', 'YT_LIVE');
    const duration = Math.floor(Number(d.duration) || 0);
    if (!duration || duration > MAX_SECONDS) throw new YtRelayError('That video is too long to play through the server', 'YT_TOO_LONG');
    const parts = Array.isArray(d.requested_formats) && d.requested_formats.length ? d.requested_formats : [d];
    const v = parts.find((f) => f.vcodec && f.vcodec !== 'none');
    const a = parts.find((f) => f.acodec && f.acodec !== 'none' && f !== v) || parts.find((f) => f.acodec && f.acodec !== 'none');
    const formats = (v && a && v !== a ? [v, a] : [v || a]).filter(Boolean).map((f) => String(f.format_id || ''));
    if (!formats.length || formats.some((f) => !/^[\w.+-]{1,40}$/.test(f))) throw new YtRelayError('YouTube gave no file a server can read for that video', 'YT_REFUSED');
    const copy = (!v || /^avc1/.test(v.vcodec)) && (!a || /^mp4a/.test(a.acodec));
    // what yt-dlp learned is kept: its own downloader then fetches each file without asking YouTube again
    return { title: String(d.title || '').slice(0, 200), duration, formats, json: JSON.stringify(d), copy, audioOnly: !v, height: v ? Number(v.height) || 0 : 0, kbit: Math.round(parts.reduce((n, f) => n + (Number(f.tbr) || 0), 0)) };
}

// ------------------------------------------------------------------------------------------ ffmpeg

/**
 * ffmpeg reads the picture and the sound from pipes (yt-dlp's own downloader fills them: YouTube's file servers
 * refuse a plain reader for some videos, 403) and writes HLS. Input n is pipe:0, pipe:3...
 */
function ffmpegArgs(src, at, dir) {
    const args = ['-hide_banner', '-loglevel', 'error'];
    src.formats.forEach((_f, i) => {
        // a start place: read and thrown away up to there (the download itself is fast)
        if (at > 0) args.push('-ss', String(at));
        args.push('-i', `pipe:${i === 0 ? 0 : 2 + i}`);
    });
    if (src.formats.length > 1) args.push('-map', '0:v:0', '-map', '1:a:0');
    // what phones play is taken as it is; anything else (a video with no H.264 that small) is encoded lightly
    if (src.copy) args.push('-c', 'copy');
    else args.push(...(src.audioOnly ? [] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p']), '-c:a', 'aac', '-b:a', '128k', '-ac', '2');
    args.push('-f', 'hls', '-hls_time', String(SEGMENT_S), '-hls_list_size', '0', '-hls_playlist_type', 'event',
        '-hls_flags', 'independent_segments+temp_file', '-hls_segment_filename', path.join(dir, 's%05d.ts'), path.join(dir, 'index.m3u8'));
    return args;
}
const toolArgs = (infoFile, format) => ['--load-info-json', infoFile, '--js-runtimes', 'node', '--no-warnings', '--no-cache-dir', '--no-part', '-q', '-f', format, '-o', '-'];

function run(session, src) {
    const args = ffmpegArgs(src, session.at, session.dir);
    let child;
    session.feeders = [];
    if (hooks.spawn) child = hooks.spawn(args, session);
    else {
        const infoFile = path.join(session.dir, 'info.json');
        fs.writeFileSync(infoFile, src.json, { mode: 0o600 });
        const feeders = src.formats.map((f) => spawn('nice', ['-n', '6', TOOL, ...toolArgs(infoFile, f)], { stdio: ['ignore', 'pipe', 'pipe'] }));
        session.feeders = feeders;
        feeders.forEach((f) => { f.stderr.on('data', (d) => { session.feedErr = ((session.feedErr || '') + d).slice(-400); }); f.on('error', () => {}); });
        child = spawn('nice', ['-n', '6', FFMPEG, ...args], { stdio: [feeders[0].stdout, 'ignore', 'pipe', ...feeders.slice(1).map((f) => f.stdout)] });
        // ffmpeg holds the pipes now: this process lets go of its ends
        feeders.forEach((f) => { f.stdout.destroy(); });
    }
    session.child = child;
    let err = '';
    if (child.stderr) child.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    child.on('error', (e) => { err = `${err}\n${e.message}`; });
    child.on('close', (code) => {
        if (session.child !== child) return;
        session.child = null;
        (session.feeders || []).forEach((f) => { try { f.kill('SIGTERM'); } catch (_e) { /* gone */ } });
        if (session.stopped) return;
        // the whole video is written (the list is closed), or the pull broke off part way
        if (code === 0) session.state = 'done';
        else { infoMemo.delete(`${session.video} ${session.mode.id}`); session.state = 'error'; session.error = String(session.feedErr || err).trim().split('\n').slice(-1)[0].replace(/^ERROR:\s*/, '') || 'The video stopped arriving'; }
    });
}

async function ready(session) {
    const started = Date.now();
    while (Date.now() - started < READY_MS && !session.stopped) {
        try {
            const text = await fs.promises.readFile(path.join(session.dir, 'index.m3u8'), 'utf8');
            if ((text.match(/#EXTINF/g) || []).length >= 1 || /#EXT-X-ENDLIST/.test(text)) return true;
        } catch (_e) { /* not written yet */ }
        if (!session.child) return session.state === 'done';
        await new Promise((r) => setTimeout(r, 300));
    }
    return false;
}

function watch() {
    if (timer || !sessions.size) return;
    timer = setInterval(() => {
        const now = Date.now();
        for (const s of sessions.values()) if (now - s.lastHit > IDLE_MS) void stop(s.id);
        if (!sessions.size) { clearInterval(timer); timer = null; }
    }, 60000);
    if (timer.unref) timer.unref();
}

const view = (s) => ({ id: s.id, video: s.video, mode: s.mode.id, state: s.state, error: s.error || '', url: `/api/videos/yt/${s.id}/index.m3u8`, at: s.at, duration: s.duration, title: s.title, height: s.height, kbit: s.kbit, copied: s.copied });

/** Start a video in a mode from `at` seconds (or take the session already doing exactly that). */
async function start(videoIn, modeId, atIn) {
    const video = String(videoIn || '');
    if (!VIDEO_ID.test(video)) throw new YtRelayError('That is not a video', 'YT_BAD_VIDEO');
    const mode = modeById(String(modeId || '')) || modeById(DEFAULT_MODE);
    const at = Math.max(0, Math.floor(Number(atIn) || 0));
    for (const s of sessions.values()) {
        if (s.video === video && s.mode.id === mode.id && s.at === at && !s.stopped && s.state !== 'error') { s.lastHit = Date.now(); if (s.starting) await s.starting; return view(s); }
    }
    const src = await info(video, mode);
    if (at >= src.duration) throw new YtRelayError('That place is past the end of the video', 'YT_BAD_PLACE');
    for (const s of [...sessions.values()]) if (s.video === video) await stop(s.id);
    while (sessions.size >= MAX_SESSIONS) await stop([...sessions.values()].sort((a, b) => a.lastHit - b.lastHit)[0].id);
    const id = crypto.randomBytes(12).toString('hex');
    const session = { id, video, mode, at, dir: path.join(ROOT, id), state: 'starting', error: '', child: null, stopped: false, lastHit: Date.now(), duration: src.duration, title: src.title, height: src.height, kbit: src.kbit, copied: !!src.copy, starting: null };
    sessions.set(id, session);
    watch();
    session.starting = (async () => {
        await fs.promises.mkdir(session.dir, { recursive: true });
        run(session, src);
        if (!(await ready(session))) throw new YtRelayError(session.error || 'The video did not start', 'YT_STREAM');
        if (session.state === 'starting') session.state = 'live';
    })();
    try {
        await session.starting;
    } catch (e) {
        await stop(id);
        throw e;
    } finally {
        session.starting = null;
    }
    return view(session);
}

async function stop(id) {
    const s = sessions.get(String(id || ''));
    if (!s) return false;
    s.stopped = true;
    sessions.delete(s.id);
    if (s.child) { try { s.child.kill('SIGTERM'); } catch (_e) { /* gone */ } }
    (s.feeders || []).forEach((f) => { try { f.kill('SIGTERM'); } catch (_e) { /* gone */ } });
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

/** Files left by a run that ended without tidying. */
function sweep() {
    fs.promises.rm(ROOT, { recursive: true, force: true }).catch(() => {});
}

function mount(app, authMiddleware) {
    app.get('/api/videos/yt/:id/:file', authMiddleware, (req, res) => {
        const s = sessions.get(String(req.params.id || ''));
        const file = String(req.params.file || '');
        if (!s || !FILE.test(file)) { res.status(404).end(); return; }
        s.lastHit = Date.now();
        const playlist = file.endsWith('.m3u8');
        res.sendFile(path.join(s.dir, file), {
            dotfiles: 'allow', // the files live under .cache
            headers: { 'Content-Type': playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Cache-Control': playlist ? 'no-store' : 'private, max-age=600, immutable' }
        }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
    });
}

module.exports = {
    mount, start, stop, state, sweep, modes: modesView, YtRelayError, DEFAULT_MODE,
    _test: { formatFor, ffmpegArgs, toolArgs, MODES, sessions, setHooks(h) { hooks = Object.assign({ info: null, spawn: null }, h); }, reset() { infoMemo.clear(); for (const s of sessions.values()) s.stopped = true; sessions.clear(); if (timer) { clearInterval(timer); timer = null; } } }
};
