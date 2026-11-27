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
 *
 * An address must outlive the session behind it. The phone's player keeps asking for the same address with the
 * screen off, so a restart or a long pause must not kill the video for good. Each session has a small record
 * (modules/videosRelayStore.js, a file outside the cache folder): the video, the quality, the place, the highest
 * piece sent, and whether the whole video was written. Only the viewer ends a video (stop): then the record goes.
 * The idle end, a restart and a module reload keep it.
 *
 * Several players can hold one video (#1410): a start that asks for what is already running joins it. A player may
 * name itself (`viewer`); the session lists who holds it, and so does the record, so the rule holds when the session
 * comes back after a restart. A named player's stop, or its start somewhere else in the video, takes only that player
 * off: the session ends, and its record goes, when nobody is left. While others hold it, an older address that only
 * that player had ends by itself. A name has no time limit (a whole video's list is read once, and a request for a
 * piece does not say who asks): a player that vanished keeps nothing running, because the idle end looks at requests
 * only. A player with no name is not listed: its stop ends the video for everybody, and its start somewhere else ends
 * what nobody is listed on. The bound of two sessions stays: a third pushes out the one asked for longest ago. When
 * somebody else is listed on that one its record stays (it can come back when there is room); else it ends for good.
 *
 * When the playlist of an address is asked for, no session is in memory and a record exists, one of two things
 * happens:
 *   - adopt: the whole video was written and its folder survived the restart. The session comes back from the
 *     files at once. No request goes to YouTube.
 *   - revive: the same address, the same place and the same quality start again in the background. The same
 *     place and the same piece size give the same pieces, so numbers and cache headers stay true. The player was
 *     somewhere inside the old list, so the new playlist is held back (503) until it reaches that place plus
 *     8 pieces, or ends. A player given a shorter list would jump back to its end. Pieces are served as soon as
 *     they exist.
 * Bounds: only the playlist ever brings a session back (a piece of a dead address is a 404). One revive per
 * address at a time. A revive may take a session nobody asked for in the last minute, never one that is being
 * watched. Each address has a budget (a growing gap, a few tries per ten minutes) so YouTube is not asked in a
 * loop. A video that can never come back (not a video, live, too long, past its end) loses its record. Every
 * other failure keeps it and the gap bounds the next try. A record is forgotten after a day.
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
const QUIET_MS = 60000; // a session not asked for this long may make room for a session that comes back
const NEED_MORE = 8; // a session that comes back reaches the place the player was at, plus this many pieces
const MAX_VIEWERS = 16; // names one session lists (the oldest goes first)
const VIEWER_ID = /^[\w.:-]{1,64}$/;
const ID_RE = /^[a-f0-9]{24}$/;
const STORE_FILE = process.env.VIDEOS_YT_STORE || path.join(__dirname, '..', '.cache', 'videos-yt-sessions.json');
const NEVER_BACK = new Set(['YT_BAD_VIDEO', 'YT_BAD_PLACE', 'YT_LIVE', 'YT_TOO_LONG']); // a video that can never come back

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
const aliases = new Map(); // an older address of the same video, place and quality -> the id of the session that serves it now
const reviving = new Map(); // id -> true while that address starts again
let timer = null;
let hooks = { info: null, spawn: null };
let store = null;
let budgetInst = null;
let swept = null; // the boot sweep in progress (a playlist waits for it)
let disposed = false; // this version was handed over (hot reload): its late callbacks write nothing
let storeWarned = false;

// ------------------------------------------------------------------------------------------ records

/** The record store (opened on first use, so this file loads without it). A store that cannot open never stops a video. */
function recCall(name, args, dflt) {
    if (disposed) return dflt;
    try {
        if (!store) store = require('./videosRelayStore').open(STORE_FILE, { ttlMs: 24 * 3600000 });
        return store[name](...args);
    } catch (e) {
        if (!storeWarned) { storeWarned = true; console.warn(`[videos] youtube records: ${String(e && e.message || e).slice(0, 160)}`); }
        return dflt;
    }
}
const recPut = (id, rec) => recCall('put', [id, rec], null);
const recGet = (id) => (ID_RE.test(id) ? recCall('get', [id], null) : null);
const recTouch = (id, patch) => recCall('touch', [id, patch], false);
const recRemove = (id) => recCall('remove', [id], false);
const recAll = () => recCall('all', [], []);
const recFlush = () => recCall('flush', [], null);
function getBudget() {
    if (!budgetInst) budgetInst = new (require('./videosRelayStore').ReviveBudget)();
    return budgetInst;
}
function budgetCall(name, id) { if (budgetInst && !disposed) { try { budgetInst[name](id); } catch (_e) { /* a budget is only a bound */ } } }

/** One address ends: its record, its way to another session and its budget entry. */
function forgetAddress(id) {
    aliases.delete(id);
    recRemove(id);
    budgetCall('forget', id);
}

/** An address ends for good, and with it the addresses that lead to it. */
function dropRecord(id) {
    forgetAddress(id);
    for (const [k, v] of [...aliases]) if (v === id) forgetAddress(k);
}

// ------------------------------------------------------------------------------------------ viewers

const cleanViewer = (v) => (typeof v === 'string' && VIEWER_ID.test(v) ? v : ''); // '' is a player with no name
/** Who a record lists (nobody: a record from before viewers had names, or of a player with no name). */
const recViewers = (r) => (r && Array.isArray(r.viewers) ? r.viewers.filter((v) => cleanViewer(v)).slice(-MAX_VIEWERS) : []);

/** The list goes into the record with a put (written on the next tick, so a restart just after still knows); lastHit stays. */
function recSetViewers(id, viewers) {
    const r = recGet(id);
    if (r) recPut(id, Object.assign(r, { viewers }));
}

/** A viewer comes off one address's record: how many it still lists, and whether this viewer was the last of them. */
function recLeave(id, viewer) {
    const list = recViewers(recGet(id));
    const rest = list.filter((v) => v !== viewer);
    if (rest.length !== list.length) recSetViewers(id, rest);
    return { left: rest.length, last: !!list.length && !rest.length };
}

/** These viewers hold the session too, and its record says so. */
function hold(s, viewers) {
    let added = false;
    for (const v of viewers) if (v && !s.viewers.has(v)) { s.viewers.add(v); added = true; }
    if (!added) return;
    while (s.viewers.size > MAX_VIEWERS) s.viewers.delete(s.viewers.values().next().value);
    recSetViewers(s.id, [...s.viewers]);
}

/** An address, and whatever led to it, now leads to session `s`. */
function leadTo(id, s) {
    for (const [from, to] of aliases) if (to === id && from !== s.id) aliases.set(from, s.id);
    aliases.set(id, s.id);
}

/**
 * A viewer leaves a session: it comes off the session and off the record of every address that leads there. True when
 * somebody else is still listed; then an older address that only this viewer had ends. With no name nothing comes off,
 * and the answer is whether anybody is listed.
 */
function leave(s, viewer) {
    s.viewers.delete(viewer);
    let held = recLeave(s.id, viewer).left > 0 || s.viewers.size > 0;
    const ended = [];
    for (const [from, to] of aliases) {
        if (to !== s.id) continue;
        const r = recLeave(from, viewer);
        if (r.left) held = true;
        else if (r.last) ended.push(from);
    }
    if (held) ended.forEach(forgetAddress);
    return held;
}

/** A named viewer's stop: true when somebody else holds the video, so nothing ends. */
function stillHeld(id, viewer) {
    const s = liveSession(id);
    return s ? leave(s, viewer) : recLeave(id, viewer).left > 0;
}

/** The session behind an address (an older address of the same timeline leads to the session that serves it now). */
function liveSession(id) {
    const s = sessions.get(id);
    if (s) return s;
    const t = aliases.get(id);
    if (!t) return null;
    const a = sessions.get(t);
    if (!a) aliases.delete(id);
    return a || null;
}

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
        if (code === 0) { session.state = 'done'; recTouch(session.id, { done: true }); recFlush(); }
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

/** The idle end: a session nobody asked for in 20 minutes goes, its record stays (the player may come back). */
function idleTick() {
    const now = Date.now();
    for (const s of [...sessions.values()]) if (now - s.lastHit > IDLE_MS) void stop(s.id, { keep: true });
    if (!sessions.size && timer) { clearInterval(timer); timer = null; }
}

function watch() {
    if (timer || !sessions.size) return;
    timer = setInterval(idleTick, 60000);
    if (timer.unref) timer.unref();
}

const view = (s) => ({ id: s.id, video: s.video, mode: s.mode.id, state: s.state, error: s.error || '', url: `/api/videos/yt/${s.id}/index.m3u8`, at: s.at, duration: s.duration, title: s.title, height: s.height, kbit: s.kbit, copied: s.copied });

/** A session object (state 'starting' until its files say otherwise). `rec` is set when the session comes back from a record. */
function makeSession(id, video, mode, at, src, rec) {
    const now = Date.now();
    const from = rec || src || {};
    return {
        id, video, mode, at, dir: path.join(ROOT, id), state: 'starting', error: '', child: null, stopped: false, lastHit: now,
        duration: from.duration || 0, title: from.title || '', height: from.height || 0, kbit: from.kbit || 0, copied: !!(rec ? rec.copied : src && src.copy), starting: null,
        maxSeg: rec ? Number(rec.maxSeg) || 0 : 0, // the highest piece a client was sent
        recHit: rec ? Number(rec.lastHit) || 0 : now, recSeg: rec ? Number(rec.maxSeg) || 0 : 0, // what the record says (it is touched only when this moves)
        viewers: new Set(recViewers(rec)),
        revived: false, caughtUp: true, need: 0, served: 0, proven: false
    };
}

/** The part every start shares: the folder, ffmpeg and the first piece written. Throws when the video did not start. */
async function launch(session, src) {
    if (session.stopped) throw new YtRelayError('The video was stopped', 'YT_STOPPED');
    await fs.promises.mkdir(session.dir, { recursive: true });
    if (session.stopped) throw new YtRelayError('The video was stopped', 'YT_STOPPED');
    run(session, src);
    if (!(await ready(session))) throw new YtRelayError(session.error || 'The video did not start', 'YT_STREAM');
    if (session.state === 'starting') session.state = 'live';
}

/** The session running exactly this video, quality and place. */
const runningAs = (video, mode, at) => [...sessions.values()].find((s) => s.video === video && s.mode.id === mode.id && s.at === at && !s.stopped && s.state !== 'error');

/**
 * A viewer who starts a place or quality leaves the video's other sessions: one that nobody else holds ends for good,
 * one that others hold plays on. A broken pull of this very place and quality is only set aside (its record stays); it
 * leads to the session `joined` at once, or to a new session when that one has started. Returns the removals under way.
 */
function leaveSessions(video, mode, at, viewer, joined) {
    const going = [];
    for (const o of [...sessions.values()]) {
        if (o === joined || o.video !== video) continue;
        if (o.mode.id === mode.id && o.at === at) {
            going.push(stop(o.id, { keep: true }));
            if (joined) { leadTo(o.id, joined); hold(joined, o.viewers); }
        } else if (!leave(o, viewer)) going.push(stop(o.id));
    }
    return going;
}

/**
 * The same for the addresses with no session: the viewer comes off every record of another place or quality of the
 * video, and one it was the last on ends. `replacing` (a new session was made): so does one that lists nobody. A
 * running session's record is left alone (leaveSessions already ended each one that nobody else holds).
 */
function leaveRecords(video, mode, at, viewer, replacing) {
    for (const r of recAll()) {
        if (r.video !== video || (r.mode === mode.id && r.at === at) || sessions.has(r.id)) continue;
        const { left, last } = recLeave(r.id, viewer);
        if (last || (replacing && !left)) forgetAddress(r.id);
    }
}

/** A start that asks for what is already running: this viewer holds it too, and leaves the video's other places. */
async function join(s, viewer) {
    s.lastHit = Date.now();
    if (viewer) { s.viewers.delete(viewer); hold(s, [viewer]); } // the newest name again
    const going = leaveSessions(s.video, s.mode, s.at, viewer, s);
    leaveRecords(s.video, s.mode, s.at, viewer, false);
    if (s.starting) await s.starting;
    await Promise.all(going);
    return view(s);
}

/** Start a video in a mode from `at` seconds (or join the session already doing exactly that). */
async function start(videoIn, modeId, atIn, viewerIn) {
    const video = String(videoIn || '');
    if (!VIDEO_ID.test(video)) throw new YtRelayError('That is not a video', 'YT_BAD_VIDEO');
    const mode = modeById(String(modeId || '')) || modeById(DEFAULT_MODE);
    const at = Math.max(0, Math.floor(Number(atIn) || 0));
    const viewer = cleanViewer(viewerIn);
    const running = runningAs(video, mode, at);
    if (running) return join(running, viewer);
    const src = await info(video, mode);
    if (at >= src.duration) throw new YtRelayError('That place is past the end of the video', 'YT_BAD_PLACE');
    // another start of the very same may have made the session while yt-dlp answered
    const made = runningAs(video, mode, at);
    if (made) return join(made, viewer);
    // from here until the new session is in place nothing awaits: two starts never make two sessions of one thing
    const going = leaveSessions(video, mode, at, viewer, null);
    // the oldest makes room; one that somebody else holds keeps its record: another player's start never ends it for good
    while (sessions.size >= MAX_SESSIONS) {
        const oldest = [...sessions.values()].sort((a, b) => a.lastHit - b.lastHit)[0];
        going.push(stop(oldest.id, { keep: [...oldest.viewers].some((v) => v !== viewer) }));
    }
    const id = crypto.randomBytes(12).toString('hex');
    const session = makeSession(id, video, mode, at, src, null);
    if (viewer) session.viewers.add(viewer);
    sessions.set(id, session);
    recPut(id, { video, mode: mode.id, at, startedAt: session.lastHit, lastHit: session.lastHit, maxSeg: 0, done: false, duration: session.duration, title: session.title, height: session.height, kbit: session.kbit, copied: session.copied, viewers: [...session.viewers] });
    leaveRecords(video, mode, at, viewer, true);
    watch();
    session.starting = Promise.all(going).then(() => launch(session, src)); // the old files go first
    try {
        await session.starting;
    } catch (e) {
        // nobody was given this address (every start that waited for it gets this error), so it ends. An older address
        // already pointed at it, or it at another, only loses that way: no other record goes with it
        for (const [from, to] of [...aliases]) if (from === id || to === id) aliases.delete(from);
        await stop(id);
        throw e;
    } finally {
        session.starting = null;
    }
    // older addresses of this very place and quality (their session is gone) now serve this session's pieces
    if (!session.stopped) {
        for (const r of recAll()) {
            if (r.video !== video || r.id === id || r.mode !== mode.id || r.at !== at || sessions.has(r.id)) continue;
            aliases.set(r.id, id);
            hold(session, recViewers(r));
        }
    }
    return view(session);
}

/**
 * End a session. Without `keep` the viewer ended the video: the record, its aliases and its budget entry go too
 * (also when no session is in memory any more). A named `viewer` ends it only when it is the last one listed; else it
 * only leaves, and the answer is false. All of that is done before the first await, so a start that follows sees it.
 * With `keep` (the idle end, making room for another) the record stays, so the same address can start again.
 */
async function stop(id, opts) {
    const key = String(id || '');
    const keep = !!(opts && opts.keep);
    const viewer = keep ? '' : cleanViewer(opts && opts.viewer);
    if (viewer && stillHeld(key, viewer)) return false;
    const s = sessions.get(key);
    if (!s) {
        const t = aliases.get(key);
        if (!keep && t && sessions.has(t)) return stop(t);
        if (!keep) dropRecord(key);
        return false;
    }
    s.stopped = true;
    sessions.delete(s.id);
    reviving.delete(s.id);
    if (keep) { if (s.state === 'done') recTouch(s.id, { done: false }); } // its files go below
    else dropRecord(s.id);
    if (s.child) { try { s.child.kill('SIGTERM'); } catch (_e) { /* gone */ } }
    (s.feeders || []).forEach((f) => { try { f.kill('SIGTERM'); } catch (_e) { /* gone */ } });
    await fs.promises.rm(s.dir, { recursive: true, force: true }).catch(() => {});
    if (!sessions.size && timer) { clearInterval(timer); timer = null; }
    return true;
}

function state(id) {
    const s = liveSession(String(id || ''));
    if (!s) return { id: String(id || ''), state: 'gone' };
    s.lastHit = Date.now();
    return view(s);
}

// ------------------------------------------------------------------------------------------ an address comes back

const PLAYLIST_END = /#EXT-X-ENDLIST/;
const readPlaylist = (dir) => fs.promises.readFile(path.join(dir, 'index.m3u8'), 'utf8').catch(() => '');

/**
 * Another session of the same video can say what a record means. The same place and quality is the same timeline: the
 * address leads there. Another place or quality makes it a stale address, but only when that session holds everybody
 * the record lists (or the record lists nobody): else it is another player's address, and it comes back by itself.
 */
function sameVideo(id, rec, mode, at, old) {
    const others = [...sessions.values()].filter((o) => o !== old && o.id !== id && o.video === rec.video && !o.stopped && o.state !== 'error');
    const listed = recViewers(rec);
    const o = others.find((x) => x.mode.id === mode.id && x.at === at);
    if (o) {
        leadTo(id, o);
        hold(o, old ? [...listed, ...old.viewers] : listed);
        if (o.revived && !o.caughtUp) o.need = Math.max(o.need, (Number(rec.maxSeg) || 0) + NEED_MORE);
        if (old) void stop(old.id, { keep: true });
        return { session: o };
    }
    if (others.some((x) => listed.every((v) => x.viewers.has(v)))) { dropRecord(id); return { status: 404 }; }
    return null;
}

/** The record read again after an await: a stop may have ended it or changed who it lists (a handed-over version keeps its copy). */
const recAgain = (id, rec) => (disposed ? rec : recGet(id));

/** The whole video was written and its folder survived: the session comes back from the files, no request to YouTube. */
async function adopt(id, rec, mode, at) {
    const text = await readPlaylist(path.join(ROOT, id));
    if (!PLAYLIST_END.test(text)) return null;
    const have = sessions.get(id);
    if (have) return { session: have };
    const now = recAgain(id, rec);
    if (!now) return { status: 404 };
    const same = sameVideo(id, now, mode, at, null);
    if (same) return same;
    const session = makeSession(id, now.video, mode, at, null, now);
    session.state = 'done';
    aliases.delete(id); // an address with a session of its own leads nowhere else
    sessions.set(id, session);
    watch();
    console.log(`[videos] youtube ${rec.video}: session taken back from its files`);
    return { session };
}

/** The same address starts again in the background (same place, same quality, same folder). */
function revive(id, rec, mode, at, old) {
    const session = makeSession(id, rec.video, mode, at, null, rec);
    session.revived = true;
    session.caughtUp = false;
    session.need = (Number(rec.maxSeg) || 0) + NEED_MORE;
    const gone = old ? stop(old.id, { keep: true }) : null; // a broken pull: its files go first, then the same folder is used again
    aliases.delete(id); // an address with a session of its own leads nowhere else
    sessions.set(id, session);
    if (old) hold(session, old.viewers);
    reviving.set(id, true);
    watch();
    const p = (async () => {
        const src = await info(session.video, mode);
        if (at >= src.duration) throw new YtRelayError('That place is past the end of the video', 'YT_BAD_PLACE');
        if (session.stopped) throw new YtRelayError('The video was stopped', 'YT_STOPPED');
        Object.assign(session, { duration: src.duration, title: src.title, height: src.height, kbit: src.kbit, copied: !!src.copy });
        if (gone) await gone;
        await fs.promises.rm(session.dir, { recursive: true, force: true }); // nothing of the old run may look like the new one
        await launch(session, src);
    })();
    session.starting = p;
    p.then(() => {
        reviving.delete(id);
        session.starting = null;
        if (!session.stopped) console.log(`[videos] youtube ${session.video}: session started again`);
    }, (e) => {
        reviving.delete(id);
        session.starting = null;
        if (session.stopped) return; // the viewer ended it, or a reload did
        console.warn(`[videos] youtube ${session.video}: could not start again (${String(e && e.message || e).slice(0, 160)})`);
        if (NEVER_BACK.has(e && e.code)) dropRecord(id);
        if (sessions.get(id) === session) void stop(id, { keep: true });
    });
}

/**
 * What a playlist request gets when its session is gone (or broke part way: `old`). Returns { session } to serve now,
 * or { status, retry } to answer. Never throws a failure of YouTube: a revive runs on its own.
 */
async function recover(id, rec, old) {
    const mode = modeById(String(rec.mode || ''));
    const at = Number(rec.at);
    if (!VIDEO_ID.test(String(rec.video || '')) || !mode || !Number.isInteger(at) || at < 0) {
        dropRecord(id);
        if (old) void stop(old.id);
        return { status: 404 };
    }
    if (rec.done && !old) {
        const a = await adopt(id, rec, mode, at);
        if (a) return a;
        recTouch(id, { done: false }); // its folder is not whole any more
        rec = recAgain(id, rec);
        if (!rec) return { status: 404 };
    }
    // from here on nothing awaits: the checks and the start are one step
    const have = sessions.get(id);
    if (have && have !== old) return { session: have };
    if (reviving.has(id)) return { status: 503, retry: 3 };
    const same = sameVideo(id, rec, mode, at, old);
    if (same) return same;
    const now = Date.now();
    let victims = [];
    const room = MAX_SESSIONS - (sessions.size - (old ? 1 : 0));
    if (room < 1) {
        victims = [...sessions.values()].filter((o) => o !== old && now - o.lastHit > QUIET_MS).sort((a, b) => a.lastHit - b.lastHit);
        if (victims.length < 1 - room) return { status: 503, retry: 10 }; // everything is being watched
        victims = victims.slice(0, 1 - room);
    }
    const budget = getBudget();
    if (!budget.take(id, now)) return { status: 503, retry: Math.ceil((Number(budget.waitMs(id, now)) || 0) / 1000) };
    victims.forEach((o) => { void stop(o.id, { keep: true }); });
    revive(id, rec, mode, at, old);
    return { status: 503, retry: 3 };
}

/** The new playlist covers the place the player was at (or the video is whole): once true it stays true. */
async function gateOpen(s) {
    if (!s.revived || s.caughtUp) return true;
    if (s.state === 'done' || s.state === 'error') { s.caughtUp = true; return true; }
    const text = await readPlaylist(s.dir);
    if (PLAYLIST_END.test(text) || (text.match(/#EXTINF/g) || []).length >= s.need) { s.caughtUp = true; return true; }
    return false;
}

/** The record learns how far this session got (the store writes to disk at its own pace). */
function noteHit(s) {
    if (s.stopped) return;
    const now = Date.now();
    if (now - s.recHit <= 5000 && s.maxSeg <= s.recSeg) return;
    s.recHit = now;
    s.recSeg = s.maxSeg;
    recTouch(s.id, { lastHit: now, maxSeg: s.maxSeg });
}

function pieceSent(s, file) {
    const n = Number(file.slice(1, 6));
    if (n > s.maxSeg) s.maxSeg = n;
    noteHit(s);
    // a session that came back played: its budget gap starts over
    if (s.revived && s.caughtUp && !s.proven && ++s.served >= 3) { s.proven = true; budgetCall('proven', s.id); }
}

/** Files left by a run that ended without tidying: a folder of a video written whole (with a record) stays, any other goes. */
function sweep() {
    const p = (async () => {
        let names = [];
        try { names = await fs.promises.readdir(ROOT); } catch (_e) { return; }
        const whole = new Set(recAll().filter((r) => r.done).map((r) => r.id));
        for (const name of names) {
            if (sessions.has(name)) { whole.delete(name); continue; }
            const dir = path.join(ROOT, name);
            if (whole.has(name) && PLAYLIST_END.test(await readPlaylist(dir))) { whole.delete(name); continue; }
            await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        for (const id of whole) if (!sessions.has(id)) recTouch(id, { done: false }); // a record whose folder is not whole
    })().catch(() => {});
    swept = p;
    p.then(() => { if (swept === p) swept = null; });
    return p;
}

function answer(res, status, retry) {
    if (status === 503) {
        res.set('Retry-After', String(Math.min(300, Math.max(1, Math.ceil(Number(retry) || 3)))));
        res.set('Cache-Control', 'no-store');
    }
    res.status(status).end();
}

async function serveFile(req, res) {
    const id = String(req.params.id || '');
    const file = String(req.params.file || '');
    if (!FILE.test(file)) { res.status(404).end(); return; }
    const playlist = file === 'index.m3u8';
    let s = liveSession(id);
    // only a playlist brings an address back (a piece of a dead address stays a 404)
    if (!s && !playlist) { res.status(404).end(); return; }
    if (playlist && (!s || s.state === 'error')) {
        if (!s && swept) { await swept; s = liveSession(id); }
        if (!s || s.state === 'error') {
            const rid = s ? s.id : id;
            const rec = recGet(rid);
            if (rec) {
                const r = await recover(rid, rec, s);
                if (!r.session) { answer(res, r.status, r.retry); return; }
                s = r.session;
            } else if (!s) { res.status(404).end(); return; }
        }
    }
    s.lastHit = Date.now();
    if (playlist) {
        if (!(await gateOpen(s))) { answer(res, 503, 2); return; }
        noteHit(s);
    }
    res.sendFile(path.join(s.dir, file), {
        dotfiles: 'allow', // the files live under .cache
        headers: { 'Content-Type': playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Cache-Control': playlist ? 'no-store' : 'private, max-age=600, immutable' }
    }, (err) => {
        if (err) { if (!res.headersSent) res.status(404).end(); return; }
        if (!playlist) pieceSent(s, file);
    });
}

/** The route's handler (late-bound through module.exports, so a reload needs no new mount). */
async function serve(req, res) {
    try {
        await serveFile(req, res);
    } catch (e) {
        console.warn(`[videos] youtube relay: ${String(e && e.message || e).slice(0, 160)}`);
        if (!res.headersSent) answer(res, 503, 5);
    }
}

function mount(app, authMiddleware) {
    app.get('/api/videos/yt/:id/:file', authMiddleware, (req, res) => module.exports.serve(req, res));
}

// ------------------------------------------------------------------------------------------ reload

/** A reload ends every session the way a restart would: records stay, a folder of a video written whole stays, the rest goes. */
function hotDispose() {
    if (timer) { clearInterval(timer); timer = null; }
    const gone = [...sessions.values()];
    sessions.clear();
    aliases.clear();
    reviving.clear();
    infoMemo.clear();
    for (const s of gone) {
        s.stopped = true;
        if (s.child) { try { s.child.kill('SIGTERM'); } catch (_e) { /* gone */ } }
        (s.feeders || []).forEach((f) => { try { f.kill('SIGTERM'); } catch (_e) { /* gone */ } });
        if (s.state !== 'done') fs.promises.rm(s.dir, { recursive: true, force: true }).catch(() => {});
    }
    recFlush();
    disposed = true; // this version's late callbacks write nothing
    return null;
}
function hotAccept() { disposed = false; } // nothing to take back; the next playlist request brings addresses back

module.exports = {
    mount, serve, start, stop, state, sweep, modes: modesView, YtRelayError, DEFAULT_MODE,
    _test: {
        formatFor, ffmpegArgs, toolArgs, MODES, sessions, aliases, idleTick, setHooks(h) { hooks = Object.assign({ info: null, spawn: null }, h); },
        setStore(st) { store = st; }, setBudget(b) { budgetInst = b; },
        reset() { infoMemo.clear(); for (const s of sessions.values()) s.stopped = true; sessions.clear(); aliases.clear(); reviving.clear(); swept = null; disposed = false; if (timer) { clearInterval(timer); timer = null; } }
    }
};

require('./hotReload').mark(module, { dispose: hotDispose, accept: hotAccept });
