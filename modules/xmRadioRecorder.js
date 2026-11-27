'use strict';
/**
 * XM Radio's cassette deck (Yozora #989; Yukimi, Nov 20 2026): recordings made on the server, into the VFS.
 *
 *   "recording with a cassette deck that you can swap the tape (recording folder, they record into VFS Recordings
 *    folder and each folder is a tape), recordings has auto split on EPG change, record metadata to files, has
 *    transport controls to listen to recordings async ... recordings are done server side not client side, when you
 *    start a recording the playback switches to listening to the recording instead of the live stream. Recordings
 *    continue for up to 8 hours and can run without client connected."
 *   "auto record based on schedule or by selecting alert on the radio or entering a search terms for it to match"
 *
 * A tape is a folder in the workspace's Recordings folder. The deck's switch picks how a recording lands on it:
 *   song   a file per cut (song, show segment), split where SiriusXM's lookAround says the cut changed, at the exact
 *          AAC frame; tagged .m4a (title, artist, album = the channel, the cover)
 *   long   one .m4a for the whole recording, a chapter per cut
 * While it records, a recording is also an HLS playlist (/api/xmradio/rec/<rid>/index.m3u8, EVENT: it grows, and
 * everything recorded so far can be paused, rewound and played again); the radio plays it instead of the live stream.
 *
 * Auto-record:
 *   timers   a channel at a time of day (on chosen weekdays, or once on a date) for a length
 *   alerts   an artist or a song picked on the radio: when it starts on any channel in the plan, that cut is recorded
 *   terms    words matched against what is on (artist, title, show): the matching cut is recorded
 * Alerts and terms read lookAround through modules/xmRadio.js's one watch timer, which runs only while there is
 * something to match or record (rule phone-power-server 7). Timers are a single setTimeout to the next start.
 *
 * Nothing needs a client: the pump (modules/xmRadioPump.js) and this file run on the server; a recording that was
 * running when the server stopped carries on if its time is not up, else it is assembled into its tape when it starts again.
 *
 * Nothing is filed while a recording runs (Yozora #1252 S7): its segments stay on disk and the files are assembled when it
 * stops, and again on demand (assemble), from the segments and the cut store. A hole (audio that left SiriusXM's window before
 * it was fetched, S6) is filled with AAC silence of its exact length and marked in the file. See "deferred assembly" below.
 *
 * Files: <cache>/xmradio-recorder.json (the deck, timers, alerts, terms, recordings in progress, settings);
 *        <cache>/xmradio-rec/<rid>/ (the recording's decrypted segments, segs.ndjson with its gap rows, cuts.ndjson, meta.json,
 *        assembly.json) until its keep time after a successful assembly has passed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cutStore = require('./xmRadioMeta');

const MAX_MS = 8 * 3600 * 1000;
const RECORDINGS = 'Recordings';
// The deck's recording settings (the console's, through setSettings): [min, max] and the defaults.
//   streamsPerAccount  streams one SiriusXM account may run at once
//   healthyBuffer      segments the pump keeps between itself and the live edge (S6)
//   behindSeconds      how far past the healthy position counts as "behind" (not during a deliberate reach-back)
//   refetchRetries     times a segment that fails its checks is fetched again by the same URL
//   keepSegmentsHours  how long a recording's raw segments are kept after it is assembled (Re-assemble needs them)
const SETTING_RANGE = { streamsPerAccount: [1, 4], healthyBuffer: [1, 20], behindSeconds: [30, 3600], refetchRetries: [0, 10], keepSegmentsHours: [0, 720] };
const SETTING_DEFAULTS = { streamsPerAccount: 1, healthyBuffer: 3, behindSeconds: 120, refetchRetries: 3, keepSegmentsHours: 24 };
const SETTING_LABEL = { streamsPerAccount: 'Streams per account', healthyBuffer: 'The healthy buffer', behindSeconds: 'Behind seconds', refetchRetries: 'Refetch retries', keepSegmentsHours: 'Hours to keep segments' };
const SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

let xm = null; // modules/xmRadio.js (bound)
let gr = null;
let st = null; // { deck: { workspaceId, tape, mode }, timers, alerts, terms, active: [] }
const recs = new Map(); // rid -> live recording
let timerHandle = null;
const fired = new Set(); // `${channelId}|${cutAt}` already recorded by an alert or term
let saveTimer = null;
let onChange = () => {};
let shuttingDown = false; // a signal is handing this process over to a new one: let no new recording start
const delay = (ms) => new Promise((ok) => setTimeout(ok, ms));
/*
 * Where this copy runs (Yukimi, Nov 21 2026: "we CAN NOT allow the recording to stop because the server stopped"):
 *   capture  the recorder service (services/xmradio-recorder): pumps, segments, cuts, timers, alerts, terms, the
 *            state file; finished files go to the spool, Dreamscape files them on the tape (it owns the file store)
 *   library  Dreamscape (modules/xmRadioRecorderClient.js): the tapes and their files only; never the state file
 */
let role = 'capture';
let onSpool = () => {};
function spoolDir() { return path.join(path.dirname(xm.accountFilePath()), 'xmradio-spool'); }

function file() { return path.join(path.dirname(xm.accountFilePath()), 'xmradio-recorder.json'); }
function recRoot() { return path.join(path.dirname(xm.accountFilePath()), 'xmradio-rec'); }

function load() {
    if (st) return st;
    try { st = JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch (_) { st = {}; }
    st.deck = Object.assign({ workspaceId: 'default', tape: 'Tape 1', mode: 'song' }, st.deck || {});
    st.timers = Array.isArray(st.timers) ? st.timers : [];
    st.alerts = Array.isArray(st.alerts) ? st.alerts : [];
    st.terms = Array.isArray(st.terms) ? st.terms : [];
    st.active = Array.isArray(st.active) ? st.active : [];
    // the common recording queue (see "the common recording queue and the slot dispatcher"): waiting entries, started ones
    // (linked to their recording by rid), and the last 100 that missed, finished or were cancelled
    st.queue = Array.isArray(st.queue) ? st.queue : [];
    for (const q of st.queue) {
        // an entry from before the common queue: a Recently Played song
        if (!q.state) q.state = 'queued';
        if (!q.kind) q.kind = 'song';
    }
    st.running = Array.isArray(st.running) ? st.running : [];
    st.history = Array.isArray(st.history) ? st.history.slice(0, 100) : [];
    st.settings = Object.assign({}, SETTING_DEFAULTS, st.settings || {});
    for (const [k, r] of Object.entries(SETTING_RANGE)) {
        const n = Number(st.settings[k]);
        st.settings[k] = Number.isInteger(n) && n >= r[0] && n <= r[1] ? n : SETTING_DEFAULTS[k];
    }
    return st;
}

/** Written off the event loop, at most once a second. */
function save() {
    if (role === 'library' || saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const s = load();
        s.active = [...recs.values()].map((r) => r.meta);
        const f = file();
        const tmp = `${f}.${process.pid}.tmp`;
        fs.promises.mkdir(path.dirname(f), { recursive: true })
            .then(() => fs.promises.writeFile(tmp, JSON.stringify(s, null, 1), { mode: 0o600 }))
            .then(() => fs.promises.rename(tmp, f))
            .catch((err) => console.warn(`[xmRadio rec] state not saved: ${err.message}`));
    }, 1000);
    if (saveTimer.unref) saveTimer.unref();
}

function changed() {
    if (role === 'library') return;
    save();
    try { onChange(); } catch (_) { /* the feed is optional */ }
}

/** The state file now (the service going down: what records goes on after its restart). */
function saveNow() {
    if (role === 'library' || !st) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    st.active = [...recs.values()].map((r) => r.meta);
    const f = file();
    try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(st, null, 1), { mode: 0o600 });
        fs.renameSync(`${f}.${process.pid}.tmp`, f);
    } catch (err) { console.warn(`[xmRadio rec] state not saved: ${err.message}`); }
}

const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const safeName = (t, max = 120) => String(t || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max);
const id8 = () => crypto.randomBytes(6).toString('hex');

// ------------------------------------------------------------------ AAC frames

/** YYYY-MM-DD on this machine's clock (a recording's name and tag; toISOString's UTC date was a day ahead after 7 pm). */
function localDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

/** The ADTS frames in a buffer: [{ off, len, sr, ch (the header's channel configuration) }] (each 1024 samples). */
function adtsFrames(buf) {
    const out = [];
    let off = 0;
    while (off + 7 <= buf.length) {
        if (buf[off] !== 0xff || (buf[off + 1] & 0xf6) !== 0xf0) { off += 1; continue; }
        const len = ((buf[off + 3] & 0x03) << 11) | (buf[off + 4] << 3) | (buf[off + 5] >> 5);
        if (len < 7 || off + len > buf.length) break;
        out.push({ off, len, sr: SR[(buf[off + 2] >> 2) & 0x0f] || 44100, ch: ((buf[off + 2] & 1) << 2) | (buf[off + 3] >> 6) });
        off += len;
    }
    return out;
}

const LAYOUT = { 1: 'mono', 2: 'stereo', 3: '3.0', 4: '4.0', 5: '5.0', 6: '5.1', 7: '7.1' };
const silenceCache = new Map(); // `${sr}/${ch}` -> one silent ADTS AAC frame

/**
 * One frame of AAC silence at the stream's sample rate and channel count: ffmpeg's anullsrc (the lavfi null audio source,
 * digital zero) encoded to ADTS AAC-LC, the third frame taken (the first carries the encoder's priming). A gap is N copies of
 * it, so the length is exact to the frame (1024 samples) and every later time in the file stays true.
 */
async function silenceFrame(sr, ch, dir) {
    const key = `${sr}/${ch}`;
    if (silenceCache.has(key)) return silenceCache.get(key);
    const tmp = path.join(dir, `silence-${sr}-${ch}.aac`);
    try {
        await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=${sr}:cl=${LAYOUT[ch] || 'stereo'}`, '-t', '1', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '64k', '-f', 'adts', tmp]);
        const buf = await fs.promises.readFile(tmp);
        const frames = adtsFrames(buf);
        if (!frames.length) throw new Error('no silence frames');
        const fr = frames[Math.min(2, frames.length - 1)];
        const frame = Buffer.from(buf.subarray(fr.off, fr.off + fr.len));
        silenceCache.set(key, frame);
        return frame;
    } finally { fs.promises.rm(tmp, { force: true }).catch(() => {}); }
}

/** The recording's stream parameters { sr, ch } from its first segment's first frame (kept on the recording). */
async function streamInfo(rec) {
    if (rec.stream) return rec.stream;
    for (const sg of rec.segs) {
        try {
            const frames = adtsFrames(require('./xmRadioPump')._test.stripId3(await fs.promises.readFile(path.join(rec.dir, sg.f))));
            if (frames.length) { rec.stream = { sr: frames[0].sr, ch: frames[0].ch }; return rec.stream; }
        } catch (_) { /* the next segment */ }
    }
    return { sr: 44100, ch: 2 };
}

/** The gaps of a recording that overlap [from, to), clipped to it: [{ from, to }]. */
function gapsIn(rec, from, to) {
    const out = [];
    for (const g of rec.gaps || []) {
        const a = Math.max(g.from, from);
        const b = Math.min(g.to, to);
        if (b - a >= 1) out.push({ from: a, to: b });
    }
    return out;
}

/**
 * The AAC of [from, to) (ms, the stream's own clock) out of a recording's segments, cut at whole frames. A hole (a gap row:
 * audio that left SiriusXM's window before it was fetched) inside the range is filled with AAC silence of its exact length.
 */
async function sliceAac(rec, from, to, outFile) {
    const fh = await fs.promises.open(outFile, 'w');
    let bytes = 0;
    try {
        const items = rec.segs.map((sg) => ({ t: sg.pdt, sg }));
        for (const g of gapsIn(rec, from, to)) items.push({ t: g.from, gap: g });
        items.sort((x, y) => x.t - y.t);
        for (const it of items) {
            if (it.gap) {
                const info = await streamInfo(rec);
                const n = Math.round((it.gap.to - it.gap.from) * info.sr / 1024000);
                if (n < 1) continue;
                const frame = await silenceFrame(info.sr, info.ch, rec.dir);
                const block = Buffer.concat(new Array(n).fill(frame));
                await fh.write(block, 0, block.length);
                bytes += block.length;
                continue;
            }
            const sg = it.sg;
            const end = sg.pdt + sg.dur * 1000;
            if (end <= from || sg.pdt >= to) continue;
            const id3 = await fs.promises.readFile(path.join(rec.dir, sg.f));
            // every tag out, the ones between frames too (a song change inside the segment): only audio goes on the tape
            const buf = require('./xmRadioPump').adtsAudio(id3) || require('./xmRadioPump')._test.stripId3(id3);
            const frames = adtsFrames(buf);
            if (!frames.length) continue;
            // the frames' own clock: the segment's start plus 1024 samples a frame
            const step = 1024000 / frames[0].sr;
            let a = -1;
            let b = -1;
            frames.forEach((fr, i) => {
                const t = sg.pdt + i * step;
                if (t >= from && t < to) { if (a < 0) a = fr.off; b = fr.off + fr.len; }
            });
            if (a < 0) continue;
            await fh.write(buf, a, b - a);
            bytes += b - a;
        }
    } finally { await fh.close(); }
    return bytes;
}

function ffmpeg(args) {
    return new Promise((resolve, reject) => {
        const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', reject);
        p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.trim().slice(0, 300)}`))));
    });
}

async function coverFile(rec, key) {
    if (!key) return null;
    const p = path.join(rec.dir, `cover-${crypto.createHash('md5').update(key).digest('hex').slice(0, 12)}.jpg`);
    try { await fs.promises.access(p); return p; } catch (_) { /* fetch it */ }
    try {
        const r = await fetch(xm.imageUrlFor(key, 600), { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return null;
        await fs.promises.writeFile(p, Buffer.from(await r.arrayBuffer()));
        return p;
    } catch (_) { return null; }
}

const ffMetaEsc = (t) => String(t || '').replace(/([=;#\\\n])/g, '\\$1');

// ------------------------------------------------------------------ tapes (VFS folders)

async function vfs() { return gr.getVfsManager(); }

async function recordingsFolder(workspaceId, create) {
    const v = await vfs();
    let f = await v._findWorkspaceFolderByName(workspaceId, null, RECORDINGS, { excludeDesktop: true });
    if (!f && create) f = await v.createFolderAtPath(`/Workspaces/${workspaceId}`, RECORDINGS);
    return f;
}

async function tapeFolder(workspaceId, name, create) {
    const root = await recordingsFolder(workspaceId, create);
    if (!root) return null;
    const v = await vfs();
    let f = await v._findWorkspaceFolderByName(workspaceId, root.id, name);
    if (!f && create) f = await v.createFolderAtPath(`/Workspaces/${workspaceId}/${root.id}`, name);
    return f;
}

async function tapes(workspaceId) {
    const root = await recordingsFolder(workspaceId, false);
    if (!root) return [];
    const db = require('./vfsDatabase');
    const list = await db.getFoldersByParent('workspace', workspaceId, root.id);
    return list.filter((f) => !f.trashed_at).map((f) => f.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Each tape's count and total length: { name: { n, dur } } (the phone's Recordings). */
async function tapesInfo(workspaceId) {
    const out = {};
    for (const name of await tapes(workspaceId)) {
        const list = await tracks(workspaceId, name);
        out[name] = { n: list.length, dur: list.reduce((t, x) => t + (x.dur || 0), 0) };
    }
    return out;
}

/** A recording's length in seconds (ffprobe once per file content, kept in this process). */
const durations = new Map();
function durationOf(hash) {
    if (durations.has(hash)) return durations.get(hash);
    const p = new Promise((resolve) => {
        let file;
        try { file = gr.getVfsManager().getFileBlobPath(hash); } catch (_) { resolve(0); return; }
        const pr = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        pr.stdout.on('data', (d) => { out += d; });
        pr.on('error', () => resolve(0));
        pr.on('exit', () => resolve(Math.round(Number(out.trim()) || 0)));
    });
    durations.set(hash, p);
    if (durations.size > 4000) durations.delete(durations.keys().next().value);
    return p;
}

/**
 * A file's own tags (the ones fileCut / fileLong wrote: title, artist, and the show out of the comment's "; show: "), read
 * once per file content and kept in this process. A file whose tags cannot be read answers empty text, never throws: the
 * console shows the name it has.
 */
const fileTags = new Map();
function tagsOf(hash) {
    if (fileTags.has(hash)) return fileTags.get(hash);
    const p = new Promise((resolve) => {
        let file;
        try { file = gr.getVfsManager().getFileBlobPath(hash); } catch (_) { resolve({ title: '', artist: '', show: '' }); return; }
        const pr = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=title,artist,comment', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        pr.stdout.on('data', (d) => { out += d; });
        pr.on('error', () => resolve({ title: '', artist: '', show: '' }));
        pr.on('exit', () => {
            let t = {};
            try { const j = JSON.parse(out); t = (j && j.format && j.format.tags) || {}; } catch (_) { t = {}; }
            const comment = String(t.comment || '');
            const show = /;\s*show:\s*([^;]*)/.exec(comment);
            resolve({ title: String(t.title || ''), artist: String(t.artist || ''), show: show ? show[1].trim() : '' });
        });
    });
    fileTags.set(hash, p);
    if (fileTags.size > 4000) fileTags.delete(fileTags.keys().next().value);
    return p;
}

/** A tape's recordings in order: [{ id, name, size, at, dur (s), title, artist, show }]. */
async function tracks(workspaceId, name) {
    const f = await tapeFolder(workspaceId, name, false);
    if (!f) return [];
    const db = require('./vfsDatabase');
    const files = await db.getUserFilesByLocation('workspace', workspaceId, f.id);
    const list = (files || []).filter((x) => !x.trashed_at && /\.(m4a|aac|mp3)$/i.test(x.original_name || ''))
        .sort((a, b) => String(a.original_name).localeCompare(String(b.original_name), undefined, { numeric: true }));
    const out = [];
    for (const x of list) {
        const tags = await tagsOf(x.content_hash);
        out.push(Object.assign({ id: x.id, name: x.original_name, size: x.size, at: x.created_at, dur: await durationOf(x.content_hash) }, tags));
    }
    return out;
}

/** A tape's folder id and its file, when the file lies in a tape (a folder of Recordings). */
async function trackOf(fileId) {
    const db = require('./vfsDatabase');
    const f = await db.getUserFileById(String(fileId || ''));
    if (!f || f.trashed_at || !f.folder_id) return null;
    const tape = await db.getFolderById(f.folder_id);
    if (!tape || tape.trashed_at || !tape.parent_id) return null;
    const root = await db.getFolderById(tape.parent_id);
    if (!root || String(root.name || '').toLowerCase() !== RECORDINGS.toLowerCase() || root.parent_id) return null;
    return { file: f, tape, workspaceId: f.workspace_id };
}

/** The file on disk for /api/xmradio/track/<id> (only files that lie in a tape). */
async function trackPath(fileId) {
    const t = await trackOf(fileId);
    if (!t) return null;
    const v = await vfs();
    const full = v.getFileBlobPath(t.file.content_hash);
    return { root: path.dirname(full), file: path.basename(full) };
}

function broadcastFolder(workspaceId, folderId) {
    const ws = gr.getWebSocketServer && gr.getWebSocketServer();
    if (ws && ws.broadcast) ws.broadcast({ type: 'vfs_updated', data: { path: `/Workspaces/${workspaceId}${folderId ? `/${folderId}` : ''}` }, timestamp: new Date().toISOString() });
}

/** Managing tapes and recordings (the phone's Recordings tab). */
async function trackRename(fileId, name) {
    const t = await trackOf(fileId);
    if (!t) throw new Error('That recording is not on a tape.');
    const ext = (/\.[a-z0-9]{2,4}$/i.exec(t.file.original_name || '') || ['.m4a'])[0];
    const base = safeName(String(name || '').replace(/\.[a-z0-9]{2,4}$/i, ''));
    if (!base) throw new Error('Name the recording.');
    await require('./vfsDatabase').updateUserFile(t.file.id, { original_name: `${base}${ext}` });
    broadcastFolder(t.workspaceId, t.tape.id);
    return { id: t.file.id, name: `${base}${ext}` };
}

async function trackDelete(fileId) {
    const t = await trackOf(fileId);
    if (!t) throw new Error('That recording is not on a tape.');
    const v = await vfs();
    await v.moveItemsToTrash([{ id: t.file.id, targetId: t.file.id, targetKind: 'user-file', kind: 'user-file', name: t.file.original_name }], `/Workspaces/${t.workspaceId}/${t.tape.id}`);
    broadcastFolder(t.workspaceId, t.tape.id);
    return { id: t.file.id };
}

async function trackMove(fileId, tapeName) {
    const t = await trackOf(fileId);
    if (!t) throw new Error('That recording is not on a tape.');
    const name = safeName(tapeName, 80);
    if (!name) throw new Error('Choose a tape.');
    const dest = await tapeFolder(t.workspaceId, name, true);
    if (dest.id === t.tape.id) return { id: t.file.id, tape: name };
    const v = await vfs();
    await v.moveItems([{ id: t.file.id }], `/Workspaces/${t.workspaceId}/${dest.id}`);
    broadcastFolder(t.workspaceId, t.tape.id);
    broadcastFolder(t.workspaceId, dest.id);
    return { id: t.file.id, tape: name };
}

async function tapeNew(workspaceId, name) {
    const n = safeName(name, 80);
    if (!n) throw new Error('Name the tape.');
    const f = await tapeFolder(workspaceId, n, true);
    broadcastFolder(workspaceId, f.parent_id);
    return { tape: n };
}

async function tapeRename(workspaceId, from, to) {
    const n = safeName(to, 80);
    if (!n) throw new Error('Name the tape.');
    const f = await tapeFolder(workspaceId, from, false);
    if (!f) throw new Error('There is no such tape.');
    if (await tapeFolder(workspaceId, n, false)) throw new Error(`There is already a tape called ${n}.`);
    const v = await vfs();
    await v.renameFolderAtPath(f.id, n);
    const s = load();
    if (s.deck.workspaceId === workspaceId && s.deck.tape === from) s.deck.tape = n;
    for (const r of recs.values()) if (r.meta.workspaceId === workspaceId && r.meta.tape === from) r.meta.tape = n;
    broadcastFolder(workspaceId, f.parent_id);
    changed();
    return { tape: n };
}

async function tapeDelete(workspaceId, name) {
    const f = await tapeFolder(workspaceId, name, false);
    if (!f) throw new Error('There is no such tape.');
    for (const r of recs.values()) if (r.meta.workspaceId === workspaceId && r.meta.tape === name) throw new Error('That tape is being recorded on.');
    const v = await vfs();
    await v.moveItemsToTrash([{ id: f.id, targetId: f.id, targetKind: 'vfs-folder', kind: 'vfs-folder', name: f.name }], `/Workspaces/${workspaceId}/${f.parent_id}`);
    broadcastFolder(workspaceId, f.parent_id);
    return { tape: name };
}

/**
 * An assembled file onto the tape. `replace` (a recording assembled again: after a crash, by hand, or after a restart) puts it
 * over the file of the same name the earlier assembly made, so the tape keeps one copy. The spool entry's id is made from the
 * recording and the name, so an entry not yet taken onto the tape is overwritten in place as well.
 */
async function fileInto(rec, tmpPath, name, { replace } = {}) {
    if (role === 'capture') {
        // the service: into the spool, Dreamscape files it on the tape (now, or when it is back)
        const id = crypto.createHash('md5').update(`${rec.meta.rid}|${name}`).digest('hex').slice(0, 24);
        const dir = spoolDir();
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.rename(tmpPath, path.join(dir, `${id}.m4a`)).catch(async () => { await fs.promises.copyFile(tmpPath, path.join(dir, `${id}.m4a`)); });
        // the description last: a spool entry counts once its .json is there
        await writeJson(path.join(dir, `${id}.json`), { workspaceId: rec.meta.workspaceId, tape: rec.meta.tape, name, at: Date.now(), rid: rec.meta.rid, replace: !!replace });
        rec.meta.filed = (rec.meta.filed || 0) + 1;
        try { onSpool(id); } catch (_) { /* told on the next connect */ }
        return `${name}.m4a`;
    }
    rec.meta.filed = (rec.meta.filed || 0) + 1;
    return saveToTape(rec.meta.workspaceId, rec.meta.tape, tmpPath, name, { replace });
}

/** A finished recording into its tape's folder (a free name, or over its own earlier copy), the folder's viewers told. Dreamscape only. */
async function saveToTape(workspaceId, tape, tmpPath, name, { replace } = {}) {
    const folder = await tapeFolder(workspaceId, tape, true);
    const v = await vfs();
    let n = `${name}.m4a`;
    if (!replace) {
        const db = require('./vfsDatabase');
        const used = new Set(((await db.getUserFilesByLocation('workspace', workspaceId, folder.id)) || []).map((x) => String(x.original_name || '').toLowerCase()));
        for (let i = 2; used.has(n.toLowerCase()); i += 1) n = `${name} (${i}).m4a`;
    }
    // overwrite: the VFS replaces the file of that name in the folder in place (none there: it is made)
    await v.saveUserFileFromPath(tmpPath, { originalName: n, mimeType: 'audio/mp4', scope: 'workspace', workspaceId, folderId: folder.id, overwrite: !!replace });
    const ws = gr.getWebSocketServer && gr.getWebSocketServer();
    if (ws && ws.broadcast) ws.broadcast({ type: 'vfs_updated', data: { path: `/Workspaces/${workspaceId}/${folder.id}` }, timestamp: new Date().toISOString() });
    return n;
}

/** Dreamscape: one spool entry (the service's finished file) onto its tape, then out of the spool. */
async function importSpool(id) {
    if (!/^[0-9a-f]{24}$/.test(id)) return false;
    const dir = spoolDir();
    let meta;
    try { meta = JSON.parse(await fs.promises.readFile(path.join(dir, `${id}.json`), 'utf8')); } catch (_) { return false; }
    const m4a = path.join(dir, `${id}.m4a`);
    await saveToTape(meta.workspaceId || 'default', meta.tape || 'Tape 1', m4a, String(meta.name || 'Recording'), { replace: !!meta.replace });
    await fs.promises.rm(m4a, { force: true });
    await fs.promises.rm(path.join(dir, `${id}.json`), { force: true });
    return true;
}

/** The spool entries waiting (oldest first). */
async function spoolList() {
    try { return (await fs.promises.readdir(spoolDir())).filter((f) => /^[0-9a-f]{24}\.json$/.test(f)).map((f) => f.slice(0, 24)); } catch (_) { return []; }
}

// ------------------------------------------------------------------ a recording

function channelOf(id) {
    const ch = xm.channelById(id);
    return ch ? { name: ch.name, number: ch.number } : { name: 'SiriusXM', number: 0 };
}

const pad2 = (n) => String(n).padStart(2, '0');
/** hh:mm:ss on this machine's clock (the same clock the file names carry). */
const clockHms = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
/** The comment a file with a hole carries: "missing audio 12:01:03-12:01:09" (several: comma separated). */
const missingNote = (gaps) => `missing audio ${gaps.map((g) => `${clockHms(g.from)}-${clockHms(g.to)}`).join(', ')}`;
const gapMs = (gaps) => gaps.reduce((t, g) => t + (g.to - g.from), 0);

/**
 * Write one cut (song mode) to the tape: [from, to). Returns the file's name, or null when there was nothing to file (a cut the
 * recording only grazed). A cut with a hole in it is marked " (gap)" after its title, in the tag and in the name, and carries
 * the comment "missing audio hh:mm:ss-hh:mm:ss"; the hole itself is AAC silence of its exact length, so the times stay true.
 */
async function fileCut(rec, cut, from, to, partial, { replace } = {}) {
    if (to - from < 5000) return null; // a cut the recording only grazed
    const gaps = gapsIn(rec, from, to);
    if (gaps.length && gapMs(gaps) >= to - from - 1000) return null; // nothing of it was recorded: silence is not a recording
    const ch = channelOf(rec.meta.channelId);
    const tmp = path.join(rec.dir, `cut-${from}.aac`);
    const out = path.join(rec.dir, `cut-${from}.m4a`);
    const bytes = await sliceAac(rec, from, to, tmp);
    if (bytes < 4096) { fs.promises.rm(tmp, { force: true }).catch(() => {}); return null; }
    const title = cut && !cut.ad && cut.t ? cut.t : (cut && cut.s) || ch.name;
    const artist = cut && !cut.ad && cut.a ? cut.a : ch.name;
    const cover = cut && !cut.ad ? await coverFile(rec, cut.ik) : null;
    const when = new Date(from);
    const gapTag = gaps.length ? ' (gap)' : '';
    const args = ['-f', 'aac', '-i', tmp];
    if (cover) args.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    args.push('-c:a', 'copy', '-bsf:a', 'aac_adtstoasc',
        '-metadata', `title=${title}${gapTag}${partial ? ' (partial)' : ''}`, '-metadata', `artist=${artist}`,
        '-metadata', `album=${ch.number ? `${ch.number} ` : ''}${ch.name}`, '-metadata', `date=${localDate(when)}`,
        '-metadata', `comment=Recorded from SiriusXM ${ch.name} on ${when.toISOString()}${cut && cut.s ? `; show: ${cut.s}` : ''}${gaps.length ? `; ${missingNote(gaps)}` : ''}`,
        '-metadata', `track=${(rec.meta.filed || 0) + 1}`,
        '-movflags', '+faststart', out);
    try {
        await ffmpeg(args);
        const stamp = `${pad2(when.getHours())}${pad2(when.getMinutes())}`;
        const name = safeName(`${localDate(when)} ${stamp} ${artist === ch.name ? title : `${artist} - ${title}`}${gapTag}`);
        return await fileInto(rec, out, name, { replace });
    } finally {
        fs.promises.rm(tmp, { force: true }).catch(() => {});
        fs.promises.rm(out, { force: true }).catch(() => {});
    }
}

/**
 * A range from the buffer (Recently Played > Record): one file for that song. It is filed from the packet's data, not
 * from lookAround's short cut history, so the name and cover survive however old the song is.
 */
async function fileRange(rec, opts) {
    if (!rec.segs.length || !rec.meta.rangeCut) return null;
    const from = rec.meta.rangeCut.at;
    const to = Math.min(rec.meta.endPdt || rec.lastEnd, rec.lastEnd);
    if (to <= from) return null;
    return fileCut(rec, rec.meta.rangeCut, from, to, !!rec.meta.endPdt && rec.lastEnd < rec.meta.endPdt - 2000, opts);
}

/**
 * Write the whole recording (long mode) as one file with a chapter per cut. A hole is a chapter of its own, "Missing audio",
 * over exactly the silence that fills it, and the file carries the comment "missing audio hh:mm:ss-hh:mm:ss".
 */
async function fileLong(rec, { replace } = {}) {
    if (!rec.segs.length) return null;
    const ch = channelOf(rec.meta.channelId);
    const from = rec.segs[0].pdt;
    const last = rec.segs[rec.segs.length - 1];
    const to = last.pdt + last.dur * 1000;
    const tmp = path.join(rec.dir, 'long.aac');
    const out = path.join(rec.dir, 'long.m4a');
    const meta = path.join(rec.dir, 'long.txt');
    if ((await sliceAac(rec, from, to, tmp)) < 4096) { fs.promises.rm(tmp, { force: true }).catch(() => {}); return null; }
    const when = new Date(from);
    const gaps = gapsIn(rec, from, to);
    const lines = [';FFMETADATA1', `title=${ffMetaEsc(`${ch.name}, ${when.toLocaleString('en-US')}`)}`, `artist=${ffMetaEsc(ch.name)}`, `album=${ffMetaEsc(ch.name)}`, `date=${localDate(when)}`];
    if (gaps.length) lines.push(`comment=${ffMetaEsc(missingNote(gaps))}`);
    // a chapter per cut, cut where a hole lies; the holes are chapters of their own
    const pieces = gaps.map((g) => ({ s: g.from, e: g.to, title: 'Missing audio' }));
    const cuts = cutsFor(rec).filter((c) => c.at < to);
    cuts.forEach((c, i) => {
        const cs = Math.max(from, c.at);
        const ce = Math.min(to, cuts[i + 1] ? cuts[i + 1].at : to);
        if (ce <= cs) return;
        const title = c.ad ? (c.s || 'Break') : [c.a, c.t].filter(Boolean).join(' - ') || c.s || ch.name;
        let at = cs;
        for (const g of gaps) {
            if (g.to <= at || g.from >= ce) continue;
            if (g.from > at) pieces.push({ s: at, e: g.from, title });
            at = Math.max(at, g.to);
        }
        if (ce > at) pieces.push({ s: at, e: ce, title });
    });
    pieces.sort((a, b) => a.s - b.s);
    for (const p of pieces) lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(p.s - from)}`, `END=${Math.round(p.e - from)}`, `title=${ffMetaEsc(p.title)}`);
    await fs.promises.writeFile(meta, `${lines.join('\n')}\n`);
    try {
        await ffmpeg(['-f', 'aac', '-i', tmp, '-i', meta, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', out]);
        return await fileInto(rec, out, safeName(`${localDate(when)} ${pad2(when.getHours())}${pad2(when.getMinutes())} ${ch.name}`), { replace });
    } finally {
        for (const p of [tmp, out, meta]) fs.promises.rm(p, { force: true }).catch(() => {});
    }
}

// ------------------------------------------------------------------ the cut store (modules/xmRadioMeta.js)
// Only the capture role reads and writes it: it is the one writer of the file (Dreamscape asks through the socket).

function metaStore() {
    if (role !== 'capture' || !xm || typeof xm.accountFilePath !== 'function') return null;
    return cutStore.open(path.join(path.dirname(xm.accountFilePath()), 'xmradio-meta.json'));
}

/** The channels worth keeping cuts for: recording now, queued, on a timer, or on a preset bank (not the whole lineup). */
function metaInterest() {
    const set = new Set();
    for (const r of recs.values()) set.add(r.meta.channelId);
    const s = load();
    for (const q of s.queue) set.add(q.channelId);
    for (const t of s.timers) set.add(t.channelId);
    try {
        const p = typeof xm.presets === 'function' ? xm.presets() : null;
        if (p) for (const b of ['A', 'B', 'C']) for (const id of p[b] || []) if (id) set.add(id);
    } catch (_) { /* presets unreadable: the rest still counts */ }
    set.delete('');
    set.delete(undefined);
    return set;
}

/** lookAround's cuts for the channels of interest, on every read. */
function metaLook(channelCuts) {
    const store = metaStore();
    if (!store) return;
    try {
        for (const id of metaInterest()) {
            const cuts = channelCuts.get(id);
            if (cuts && cuts.length) store.merge(id, cuts.map((c) => ({ at: c.at, a: c.a, t: c.t, s: c.s, ad: c.ad, ik: c.ik })), { source: 'lookAround', channelName: channelOf(id).name });
        }
    } catch (err) { console.warn(`[xmRadio rec] cut store: ${err.message}`); }
}

/** liveUpdate for a channel over [from, to] into the store; the recordings on it are told (a name may have arrived). */
async function metaRange(channelId, from, to) {
    const store = metaStore();
    if (!store || typeof xm.liveUpdateRange !== 'function') return null;
    const range = await xm.liveUpdateRange(channelId, from, to);
    const res = store.mergeRange(channelId, range, { source: 'liveUpdate', channelName: channelOf(channelId).name });
    for (const r of recs.values()) if (r.meta.channelId === channelId) void checkCutEnd(r);
    return res;
}

/** One read for a recording that starts or resumes reaching back; its cuts are not filed until it has landed. */
function metaBackfill(rec, from) {
    if (!metaStore() || typeof xm.liveUpdateRange !== 'function') return;
    const channelId = rec.meta.channelId;
    metaRead.set(channelId, Date.now());
    rec.metaPending = metaRange(channelId, from - 60000, Date.now())
        .catch((err) => console.warn(`[xmRadio rec] ${rec.meta.rid}: cut names not read (${err.message}); lookAround's stand in`))
        .finally(() => { rec.metaPending = null; });
}

// One timer, only while a recording runs: each recording's channel is read again over the window since the last read
// (ten minutes of overlap), every two minutes, backing off on a failure.
const META_EVERY_MS = 120000;
const META_MAX_MS = 15 * 60000;
const metaRead = new Map(); // channelId -> when it was last read (ms)
let metaTimer = null;
let metaFails = 0;
function armMetaTimer(ms) {
    if (metaTimer || !recs.size || !metaStore() || typeof xm.liveUpdateRange !== 'function') return;
    metaTimer = setTimeout(() => { void metaTick(); }, ms == null ? META_EVERY_MS : ms);
    if (metaTimer.unref) metaTimer.unref();
}
async function metaTick() {
    metaTimer = null;
    if (!recs.size || shuttingDown) return;
    let failed = false;
    for (const channelId of new Set([...recs.values()].map((r) => r.meta.channelId))) {
        const now = Date.now();
        try {
            await metaRange(channelId, (metaRead.get(channelId) || now) - 10 * 60000, now);
            metaRead.set(channelId, now);
        } catch (err) {
            failed = true;
            console.warn(`[xmRadio rec] cut names for ${channelId}: ${err.message} (next try in ${Math.round(Math.min(META_MAX_MS, META_EVERY_MS * 2 ** (metaFails + 1)) / 1000)} s)`);
        }
    }
    metaFails = failed ? metaFails + 1 : 0;
    armMetaTimer(Math.min(META_MAX_MS, META_EVERY_MS * 2 ** metaFails));
}
function stopMetaTimer() {
    clearTimeout(metaTimer);
    metaTimer = null;
    metaFails = 0;
    metaRead.clear();
}

/*
 * The stop guard (Yukimi, Nov 26 2026). The stop tests (`until`, `endPdt`, MAX_MS) used to live only inside `appendSeg`, so
 * they ran only when a segment arrived: a pump that could not fetch a segment held the recording for hours past its own end
 * time, and nothing ended it. One timer runs while any recording does (no interval; re-armed, unref'd, cleared with the last
 * recording) and ends the ones whose time is up, exactly as appendSeg would. It also tells the deck when a recording crosses
 * into "writing nothing" and back, so the console shows a stalled recording instead of numbers that stopped moving.
 */
const STOP_CHECK_MS = 30000;
const STALL_PUSH_S = 60;
let stopCheckHandle = null;
function armStopCheck() {
    clearTimeout(stopCheckHandle);
    stopCheckHandle = null;
    if (role === 'library' || shuttingDown || !recs.size) return;
    stopCheckHandle = setTimeout(() => { stopCheckHandle = null; void stopCheck(); }, STOP_CHECK_MS);
    if (stopCheckHandle.unref) stopCheckHandle.unref();
}
async function stopCheck() {
    if (shuttingDown) return;
    const now = Date.now();
    let push = false;
    for (const rec of [...recs.values()]) {
        const m = rec.meta;
        const due = (m.until && now >= m.until) || (m.endPdt && rec.lastEnd >= m.endPdt) || (rec.lastEnd && rec.lastEnd - m.startPdt >= MAX_MS);
        if (due) {
            console.log(`[xmRadio rec] ${m.rid}: its time is up; stopping it and assembling what it holds`);
            void stop(m.rid);
            continue;
        }
        const stalled = rec.lastSegAt ? Math.round((now - rec.lastSegAt) / 1000) : 0;
        const is = stalled >= STALL_PUSH_S;
        if (is !== !!rec.stalledPushed) { rec.stalledPushed = is; push = true; }
    }
    if (push) changed();
    armStopCheck();
}

/**
 * The cuts of a recording's channel as the store has them (names that outlive lookAround's short window), over what
 * lookAround gave the recording itself; rec.cuts stays as the fallback and keeps a name the store has not got yet.
 */
function cutsFor(rec) {
    const m = rec.meta;
    const store = m && m.channelId ? metaStore() : null;
    if (!store) return rec.cuts;
    let rows;
    try { rows = store.cutsBetween(m.channelId, (rec.segs && rec.segs[0] && rec.segs[0].pdt) || m.startPdt || 0, 0, { episodes: false }); } catch (_) { return rec.cuts; }
    if (!rows.length) return rec.cuts;
    const by = new Map(rec.cuts.map((c) => [c.at, c]));
    for (const r of rows) {
        const own = by.get(r.at);
        // a store row with nothing to say (an ad, no name yet) does not hide a real name the recording has seen
        if (own && !own.ad && own.t && (r.ad || !r.title)) continue;
        by.set(r.at, { at: r.at, a: r.artist, t: r.title, ad: r.ad, s: r.album, ik: r.ik || (own && own.ik) || '' });
    }
    return [...by.values()].sort((a, b) => a.at - b.at);
}

/** The cut in force at a moment, and when it ends (the next cut's start, or null). */
function cutAt(rec, t) {
    let cur = null;
    let next = null;
    for (const c of cutsFor(rec)) {
        if (c.at <= t) cur = c;
        else { next = c; break; }
    }
    return { cur, next };
}

/** A promise or a wait, whichever is first (the timer does not outlive it). */
function raceWait(promise, ms) {
    let t;
    return Promise.race([promise, new Promise((ok) => { t = setTimeout(ok, ms); })]).finally(() => clearTimeout(t));
}

// Kinds that record one cut and stop when it ends (an alert, a term, the phone's one-touch Record, a queued cut)
const oneCutKind = (k) => k === 'alert' || k === 'term' || k === 'song';

/**
 * Nothing is filed while a recording runs (Yozora #1252 S7: the segments stay on disk and the files are assembled when it
 * ends). A one-cut recording still stops when its cut ends: the next cut starts at or before where the recording has got to.
 */
async function checkCutEnd(rec) {
    if (rec.meta.mode !== 'song' || !oneCutKind(rec.meta.kind) || rec.cutChecking || rec.stopping) return;
    rec.cutChecking = true;
    try {
        // the names the store is being given for a reach-back are in before the cut's end is decided
        // (at most a minute: a slow liveUpdate must not hold the recording on; lookAround's names stand in)
        if (rec.metaPending) await raceWait(rec.metaPending, 60000);
        if (rec.stopping) return;
        const start = rec.meta.cursor || (rec.segs[0] && rec.segs[0].pdt) || 0;
        const { next } = cutAt(rec, start + 1);
        if (next && next.at <= rec.lastEnd) void stop(rec.meta.rid);
    } finally { rec.cutChecking = false; }
}

/** How often a recording's progress alone (segments written) is pushed to the deck; a state change or a gap is pushed at once. */
const PROGRESS_PUSH_MS = 60000;

/** A hole in a recording: audio between from and to (ms) that left SiriusXM's window before it was fetched. */
function noteGap(rec, from, to) {
    if (!(to - from >= 1)) return;
    if (rec.gaps.some((g) => g.from <= from + 1000 && g.to >= to - 1000)) return; // the pump and the recorder both saw it
    rec.gaps.push({ from, to });
    rec.write = rec.write.then(() => fs.promises.appendFile(path.join(rec.dir, 'segs.ndjson'), `${JSON.stringify({ gap: true, from, to })}\n`))
        .catch((err) => console.warn(`[xmRadio rec] ${rec.meta.rid}: ${err.message}`));
    console.warn(`[xmRadio rec] ${rec.meta.rid}: ${Math.round((to - from) / 1000)} s of audio missing (${new Date(from).toISOString()} to ${new Date(to).toISOString()}); marked as a gap`);
    changed();
}

function appendSeg(rec, sg) {
    // a pump still sending for a recording that has stopped (Nov 21 2026: one went on writing into its removed folder
    // for 15 minutes after its stop): it is stopped here, its segment dropped
    if (rec.stopping || recs.get(rec.meta.rid) !== rec) {
        if (!rec.strayLogged) { rec.strayLogged = true; console.warn(`[xmRadio rec] ${rec.meta.rid}: segments after the stop; pump stopped`); }
        try { rec.pump && rec.pump.stop(); } catch (_) { /* stopped */ }
        return;
    }
    // a segment it already has (a resumed pump reads from a little before where the recording left off)
    if (rec.segs.length && (sg.pdt < rec.lastEnd - 500 || rec.segs.some((x) => x.seq === sg.seq && Math.abs(x.pdt - sg.pdt) < 1000))) return;
    // audio missing before this segment (the pump says so itself; this is the same check for a pump that did not)
    if (rec.segs.length && sg.pdt > rec.lastEnd + 1000) noteGap(rec, rec.lastEnd, sg.pdt);
    const f = `s${sg.seq}.aac`;
    const row = { seq: sg.seq, pdt: sg.pdt, dur: sg.dur, f, ok: false };
    rec.segs.push(row);
    rec.lastEnd = sg.pdt + sg.dur * 1000;
    rec.lastSegAt = Date.now(); // the console's stalled marker counts from here
    rec.meta.written = (rec.meta.written || 0) + 1;
    rec.write = rec.write.then(async () => {
        await fs.promises.writeFile(path.join(rec.dir, f), sg.plain);
        await fs.promises.appendFile(path.join(rec.dir, 'segs.ndjson'), `${JSON.stringify({ seq: row.seq, pdt: row.pdt, dur: row.dur, f })}\n`);
        // listed in the playlist only now that its file is there (a listener near the edge asked for a segment still
        // being written and stalled)
        row.ok = true;
    }).catch((err) => console.warn(`[xmRadio rec] ${rec.meta.rid}: ${err.message}`));
    if (rec.lastEnd - rec.meta.startPdt >= MAX_MS || (rec.meta.until && Date.now() >= rec.meta.until) || (rec.meta.endPdt && rec.lastEnd >= rec.meta.endPdt)) { void stop(rec.meta.rid); return; }
    void checkCutEnd(rec);
    // the deck: at once when the state moves (buffering to recording), else its progress once a minute
    const state = healthOf(rec).state;
    if (state !== rec.lastState || Date.now() - (rec.lastPush || 0) >= PROGRESS_PUSH_MS) { rec.lastState = state; rec.lastPush = Date.now(); changed(); }
}

/** Cuts read from lookAround for this recording's channel (from modules/xmRadio.js's watch). */
function noteCuts(rec, cuts) {
    let added = false;
    for (const c of cuts) {
        if (rec.cuts.some((x) => x.at === c.at)) continue;
        rec.cuts.push(c);
        added = true;
        fs.promises.appendFile(path.join(rec.dir, 'cuts.ndjson'), `${JSON.stringify(c)}\n`).catch(() => {});
    }
    if (!added) return;
    rec.cuts.sort((a, b) => a.at - b.at);
    void checkCutEnd(rec);
    changed();
}

function makePump(rec, back, from) {
    const pump = require('./xmRadioPump').createPump({
        channelId: rec.meta.channelId, quality: 'hi',
        // the recording's own SiriusXM account (its slot; none = slot 1, the radio's account)
        keyBytes: (uri) => xm.keyBytes(uri, { slot: rec.meta.slot || 1 }),
        tune: async (id) => xm.tuneUpstream(id, { slot: rec.meta.slot || 1 }),
        log: (lvl, t) => console.warn(t),
        // the console's buffer settings, read on every tick
        settings: () => load().settings,
        // a recording keeps trying through a missing sign-in (the token comes from Dreamscape)
        persistent: true
    });
    pump.on('segment', (sg) => appendSeg(rec, sg));
    pump.on('gap', (g) => noteGap(rec, g.from, g.to));
    pump.on('pause', () => { rec.meta.pauses = (rec.meta.pauses || 0) + 1; changed(); });
    pump.on('refetch', () => { rec.meta.refetches = (rec.meta.refetches || 0) + 1; changed(); });
    pump.on('state', () => changed());
    pump.on('error', (err) => { rec.meta.error = err.message; void stop(rec.meta.rid); });
    pump.start({ back, from });
    return pump;
}

/**
 * A recording's state and counters (the deck's recordings carry them; Lizumi shows them):
 *   state        buffering (holds fewer than healthyBuffer segments) | recording | paused-refilling (waiting for the stream's
 *                buffer to refill) | behind (more than behindSeconds past the healthy position, not a deliberate reach-back)
 *   segsWritten  segments written for it, segsExpected (position - start) / mean segment length, held (on disk now)
 *   gaps, gapSeconds, refetches, pauses, behindS, bufferSegs (what the stream held beyond the position at its last read)
 */
function healthOf(rec) {
    const m = rec.meta;
    const set = load().settings;
    let ps = null;
    try { ps = rec.pump && typeof rec.pump.stats === 'function' ? rec.pump.stats() : null; } catch (_) { ps = null; }
    const segs = rec.segs || [];
    const held = segs.length;
    let state = ps ? ps.state : 'recording';
    if (state === 'buffering' && held >= set.healthyBuffer) state = 'recording';
    else if (state === 'recording' && held < set.healthyBuffer) state = 'buffering';
    const mean = held ? segs.reduce((t, x) => t + x.dur, 0) / held : 0;
    const base = held ? Math.min(m.startPdt || segs[0].pdt, segs[0].pdt) : 0;
    const gaps = (rec.gaps || []).map((g) => ({ from: g.from, to: g.to }));
    return {
        state, segsWritten: m.written || held, segsExpected: mean ? Math.max(held, Math.round((rec.lastEnd - base) / 1000 / mean)) : 0, held,
        gaps, gapSeconds: Math.round(gaps.reduce((t, g) => t + (g.to - g.from), 0) / 1000),
        refetches: m.refetches || 0, pauses: m.pauses || 0, behindS: ps ? ps.behindS : 0, bufferSegs: ps ? ps.bufferSegs : 0,
        // how long since a segment was last written (the console's stalled marker: a recording that is not writing audio is
        // not quietly fine), and the segment that is holding it, with what the pump says about it
        stalled: rec.lastSegAt ? Math.max(0, Math.round((Date.now() - rec.lastSegAt) / 1000)) : 0,
        holes: ps ? Number(ps.holes) || 0 : 0,
        stuckSeq: ps && ps.stuckSeq != null ? ps.stuckSeq : null
    };
}

// ------------------------------------------------------------------ the common recording queue and the slot dispatcher
// (Yozora #1252 S3; Yukimi, Nov 26 2026: "the recorder slots are a pool of consumers on one common queue")
//
// Every producer - Recently Played's Record, one-touch Record, the deck's REC, a timer that fires, an alert or term that
// matches - makes an ENTRY and puts it in one queue. One dispatcher hands the next due entry to a free virtual radio
// (a slot): signed in, entitled to the channel, and not already streaming. Nothing is pinned to a slot.
//
//   entry { id, kind (song | cut | channel | timer | alert | term), channelId, from (ms: the first moment wanted; now for
//           "from now"), to (the end of the window, 0 = open), until (wall-clock end of an open one), mode, fromCut, fromNow,
//           a, t, s, ik, rangeCut, ref, addedAt, expiresAt, state (queued | running | missed | done | cancelled), slot,
//           rid, startedAt, endedAt, reason }
//
// Waiting costs nothing: a recording reaches back to `from` (the stream keeps five hours), so a started-late entry still
// has its first moment. What cannot be undone is the buffer running out: expiresAt = from + 5 h - 60 s is the last moment
// the start can still be fetched, and an entry that passes it is MISSED, with its reason, never silently dropped.
//
// Where entries live (st = the state file): st.queue (waiting, state queued), st.running (started, linked to their
// recording by rid; they survive a restart as the recordings resume), st.history (missed, done and cancelled: the last 100,
// newest first).
//
// One stream per SiriusXM account, slot 1 included (Yukimi: "a job goes only to a slot whose account is entitled to that
// channel and is not already streaming"). Deck setting streamsPerAccount (1 to 4, default 1) raises that if SiriusXM
// tolerates it. The radio app's own live listening is NOT counted: it is the page's own tune, not a recording.
const BUFFER_MS = 5 * 3600 * 1000; // the stream keeps five hours
const EXPIRY_MARGIN_MS = 60000; // the last start that can still be fetched
const QUEUE_TTL = BUFFER_MS; // (alerts and terms: how old a cut can be)
const MAX_QUEUE = 50;
const HISTORY_MAX = 100;
const MAX_SLOTS = 8;
const REC_KIND = { song: 'song', cut: 'song', channel: 'manual', timer: 'timer', alert: 'alert', term: 'term' };
const ENTRY_KIND = { manual: 'channel', song: 'cut', timer: 'timer', alert: 'alert', term: 'term' };
const MISSED_BUFFER = 'No virtual radio came free before it left the five-hour buffer';
const MISSED_ENTITLED = 'No signed-in account is entitled to this channel';
const reserved = new Map(); // slot -> starts that have passed the slot check and are still making their folder
let expiryHandle = null;

function slotTotal() {
    try { const n = typeof xm.slotCount === 'function' ? Number(xm.slotCount()) : 1; return n >= 1 && n <= MAX_SLOTS ? Math.floor(n) : 1; } catch (_) { return 1; }
}
function slotIsReady(n) {
    try { return typeof xm.slotReady === 'function' ? !!xm.slotReady(n) : true; } catch (_) { return false; }
}
function slotEntitled(n, channelId) {
    try { return typeof xm.slotCanPlay === 'function' ? !!xm.slotCanPlay(n, channelId) : true; } catch (_) { return false; }
}
function streamsCap() { return load().settings.streamsPerAccount; }
/** Recordings streaming on a slot's account now (a stopping one has already stopped its pump). */
function streamsOn(n) {
    let c = reserved.get(n) || 0;
    for (const r of recs.values()) if ((r.meta.slot || 1) === n && !r.stopping) c += 1;
    return c;
}
function anyEntitled(channelId) {
    for (let n = 1; n <= slotTotal(); n++) if (slotEntitled(n, channelId)) return true;
    return false;
}
/** The slots that can take a recording of this channel now, in slot order: signed in, entitled, under the stream limit,
 *  and not already recording this channel (the same channel twice only on different slots). */
function freeSlots(channelId) {
    const out = [];
    const cap = streamsCap();
    for (let n = 1; n <= slotTotal(); n++) {
        if (streamsOn(n) >= cap || !slotEntitled(n, channelId)) continue;
        let same = false;
        for (const r of recs.values()) if (!r.stopping && (r.meta.slot || 1) === n && r.meta.channelId === channelId) same = true;
        if (!same) out.push(n);
    }
    return out;
}

/** When an entry's start can no longer be fetched (an entry written without one: five hours from its first moment). */
const expOf = (e) => e.expiresAt || ((e.from || e.addedAt || Date.now()) + BUFFER_MS - EXPIRY_MARGIN_MS);

function makeEntry(kind, channelId, o = {}) {
    const now = Date.now();
    const from = Number(o.from) || now;
    return {
        id: id8(), kind, channelId: String(channelId || ''), from, to: Number(o.to) || 0, until: Number(o.until) || 0,
        mode: o.mode || null, fromCut: Number(o.fromCut) || 0, fromNow: !!o.fromNow, tape: o.tape ? String(o.tape).slice(0, 80) : '', notify: !!o.notify,
        a: String(o.a || '').slice(0, 200), t: String(o.t || '').slice(0, 200), s: String(o.s || '').slice(0, 200), ik: String(o.ik || '').slice(0, 200),
        rangeCut: o.rangeCut || null, ref: o.ref || null, addedAt: now, expiresAt: from + BUFFER_MS - EXPIRY_MARGIN_MS,
        state: 'queued', slot: null, rid: null, startedAt: 0, endedAt: 0, reason: ''
    };
}

/** The opts startRec takes for an entry, worked out at the moment it starts (so a late start reaches back to `from`). */
function startOpts(e, now, slot) {
    const kind = e.kind || 'song';
    const o = { channelId: e.channelId, slot, kind: REC_KIND[kind] || 'manual', ref: e.ref || null, mode: e.mode || undefined };
    if (e.tape) o.tape = e.tape; // a rule's destination tape; else the deck's own
    // a start that is not "from now" (and any late one) reaches back to the first moment wanted
    o.back = e.fromNow && now - e.from < 2000 ? 0 : Math.max(0, Math.ceil((now - e.from) / 1000) + 8);
    if (kind === 'song') {
        o.mode = 'range';
        o.fromCut = e.from;
        o.endPdt = e.to;
        o.until = now + 10 * 60000;
        o.rangeCut = e.rangeCut || { at: e.from, a: e.a || '', t: e.t || '', s: e.s || '', ik: e.ik || '', ad: false };
        return o;
    }
    if (e.fromCut) o.fromCut = e.fromCut;
    if (e.to) { o.endPdt = e.to; o.until = Math.max(now, e.to) + 10 * 60000; }
    else if (e.until) o.until = Math.max(e.until, now + 10 * 60000);
    return o;
}

/** The entry for a direct start() (the socket op, a test): the recording it is about to make. */
function entryFromStart(opts) {
    const now = Date.now();
    const back = Math.max(0, Math.min(5 * 3600, Number(opts.back) || 0));
    const kind = opts.mode === 'range' ? 'song' : (ENTRY_KIND[opts.kind || 'manual'] || 'channel');
    const rc = opts.rangeCut || {};
    return makeEntry(kind, opts.channelId, {
        from: now - back * 1000, to: opts.endPdt, until: opts.until, mode: opts.mode, fromCut: opts.fromCut, fromNow: !back,
        ref: opts.ref, rangeCut: opts.rangeCut, a: rc.a, t: rc.t, s: rc.s
    });
}

/** The entry has left the lists for good: missed, done or cancelled. History keeps the last 100. */
function retire(e, state, reason) {
    const s = load();
    s.queue = s.queue.filter((x) => x !== e && x.id !== e.id);
    s.running = s.running.filter((x) => x !== e && x.id !== e.id);
    e.state = state;
    e.endedAt = Date.now();
    if (reason) e.reason = String(reason);
    s.history.unshift(e);
    if (s.history.length > HISTORY_MAX) s.history.length = HISTORY_MAX;
}

/** The soonest-expiring waiting entry first, then the order they were added. */
function queueSorted() {
    return (load().queue || []).slice().sort((a, b) => (expOf(a) - expOf(b)) || ((a.addedAt || 0) - (b.addedAt || 0)));
}
const entryPublic = (q, position) => ({
    id: q.id, kind: q.kind || 'song', state: q.state || 'queued', channelId: q.channelId, from: q.from, to: q.to || 0,
    a: q.a || '', t: q.t || '', s: q.s || '', ik: q.ik || '', mode: q.mode || null, ref: q.ref || null, tape: q.tape || '', notify: !!q.notify,
    slot: q.slot || null, rid: q.rid || null, position: position || 0,
    expiresAt: q.expiresAt, addedAt: q.addedAt, startedAt: q.startedAt || 0, endedAt: q.endedAt || 0, reason: q.reason || ''
});
/** The waiting entries in due order (the radio app and the phone read id, channelId, from, to, a, t, expiresAt, addedAt). */
function queuePublic() {
    return queueSorted().map((q, i) => entryPublic(q, i + 1));
}
function jobsPublic() {
    return (load().running || []).map((q) => entryPublic(q, 0));
}
function queueRemove(id) {
    const s = load();
    const e = s.queue.find((q) => q.id === String(id || ''));
    if (e) { retire(e, 'cancelled', 'Cancelled'); armExpiry(); changed(); }
    return queuePublic();
}
function queueClear() {
    const s = load();
    if (s.queue.length) { for (const e of s.queue.slice()) retire(e, 'cancelled', 'Cancelled'); armExpiry(); changed(); }
    return queuePublic();
}
/** Cancel one waiting entry (any producer's); { id, state, queue }. A started one is stopped with stop(rid). */
function cancel(id) {
    const s = load();
    const e = s.queue.find((q) => q.id === String(id || ''));
    if (!e) {
        const run = s.running.find((q) => q.id === String(id || ''));
        throw Object.assign(new Error(run ? 'That recording has started: stop it from the deck.' : 'That entry is not waiting.'), { code: 'XMRADIO_QUEUE_NOT_WAITING' });
    }
    retire(e, 'cancelled', 'Cancelled');
    armExpiry();
    changed();
    return { id: e.id, state: e.state, queue: queuePublic() };
}

/** A recording already running that covers this entry (same channel, its window inside the recording's): the entry joins
 *  it instead of starting a second stream. A range recording covers only its own song; a recording that stops after one cut
 *  (an alert, a term, a song) covers only that cut. */
function coveringRec(e) {
    for (const rec of recs.values()) {
        const m = rec.meta;
        if (rec.stopping || m.channelId !== e.channelId) continue;
        const kind = e.kind || 'song';
        const oneCut = kind === 'song' || kind === 'cut' || kind === 'alert' || kind === 'term';
        if (m.mode === 'range') {
            if (kind === 'song' && m.rangeCut && m.rangeCut.at === e.from && (m.endPdt || 0) === (e.to || 0)) return rec;
            continue;
        }
        if (m.kind === 'song' || m.kind === 'alert' || m.kind === 'term') {
            // the cut it records: fromCut, or for a recording started before fromCut was kept, the cut its song-mode cursor
            // still stands on (a one-cut recording stops at its first filed cut, so the cursor has not moved on)
            const mCut = m.fromCut || m.cursor || 0;
            if (oneCut && ((e.fromCut && e.fromCut === mCut) || (kind === 'cut' && e.fromNow))) return rec;
            continue;
        }
        const runStart = m.startPdt || m.since || 0;
        const runEnd = m.endPdt || m.until || 0;
        const eEnd = e.to || e.until || e.from + MAX_MS;
        if (e.from >= runStart - 5000 && eEnd <= runEnd + 60000) return rec;
    }
    return null;
}

function attach(e, rec) {
    const s = load();
    s.queue = s.queue.filter((x) => x !== e && x.id !== e.id);
    e.state = 'running';
    e.rid = rec.meta.rid;
    e.slot = rec.meta.slot || 1;
    e.startedAt = Date.now();
    e.attached = true;
    s.running.push(e);
}

/** Entries whose five hours ran out while they waited: missed, with the reason. */
function expireDue() {
    const now = Date.now();
    for (const e of load().queue.slice()) {
        if (now < expOf(e)) continue;
        const why = anyEntitled(e.channelId) ? MISSED_BUFFER : MISSED_ENTITLED;
        console.warn(`[xmRadio rec] queued ${e.id} (${e.kind || 'song'}): missed - ${why}`);
        retire(e, 'missed', why);
        changed();
    }
}

/** One timer (no interval), to the soonest expiry among the waiting entries. */
function armExpiry() {
    clearTimeout(expiryHandle);
    expiryHandle = null;
    if (shuttingDown || role === 'library' || !st) return;
    let soonest = 0;
    for (const e of st.queue) if (!soonest || expOf(e) < soonest) soonest = expOf(e);
    if (!soonest) return;
    expiryHandle = setTimeout(() => { expiryHandle = null; void dispatch(); }, Math.min(Math.max(0, soonest - Date.now()) + 5, 2 ** 31 - 1));
    if (expiryHandle.unref) expiryHandle.unref();
}

let dispatching = null;
let dispatchAgain = false;
/**
 * The dispatcher: runs when an entry is added, a recording stops (a slot came free), a slot's token arrives or clears,
 * the expiry timer fires, the deck setting changes, and after resume(). Re-entrancy guarded: a call while it runs makes it
 * go round once more and returns the run in progress.
 */
function dispatch() {
    if (role === 'library') return Promise.resolve();
    if (dispatching) { dispatchAgain = true; return dispatching; }
    dispatching = (async () => {
        await null;
        try {
            do { dispatchAgain = false; await dispatchPass(); } while (dispatchAgain);
        } catch (err) { console.warn(`[xmRadio rec] dispatcher: ${err.message}`); }
        finally { dispatching = null; armExpiry(); }
    })();
    return dispatching;
}

async function dispatchPass() {
    if (shuttingDown || !xm) return;
    expireDue();
    const skip = new Set(); // entries whose start failed this pass: they wait for the next trigger
    for (;;) {
        let pick = null;
        for (const e of queueSorted()) {
            if (skip.has(e.id)) continue;
            const cover = coveringRec(e);
            if (cover) { pick = { e, cover }; break; }
            const slot = freeSlots(e.channelId)[0];
            if (slot) { pick = { e, slot }; break; }
        }
        if (!pick) break;
        const { e } = pick;
        if (pick.cover) { attach(e, pick.cover); changed(); continue; }
        const s = load();
        s.queue = s.queue.filter((x) => x !== e);
        try {
            const rec = await startRec(startOpts(e, Date.now(), pick.slot), e);
            if (e.state !== 'running') { attach(e, rec); changed(); } // the slot already recorded this channel
        } catch (err) {
            if (err && err.code === 'XMRADIO_CHANNEL') { retire(e, 'missed', err.message); changed(); continue; }
            console.warn(`[xmRadio rec] queued ${e.id}: ${err.message}`);
            s.queue.push(e);
            skip.add(e.id);
            if (err && err.code === 'XMRADIO_REC_SHUTDOWN') break;
        }
    }
}

/** Enqueue an entry and dispatch. `fast`: an answer the person is waiting for - with no signed-in account that can play the
 *  channel it fails now rather than wait for one (timers, alerts and terms wait: an account may sign in). */
async function submit(entry, { fast } = {}) {
    if (shuttingDown) throw Object.assign(new Error('The recorder is handing over to a new process.'), { code: 'XMRADIO_REC_SHUTDOWN' });
    const s = load();
    if (!xm.channelById(entry.channelId)) throw Object.assign(new Error('No such channel.'), { code: 'XMRADIO_CHANNEL' });
    const dup = s.queue.find((q) => q.channelId === entry.channelId && (q.kind || 'song') === entry.kind && q.from === entry.from && (q.to || 0) === entry.to);
    if (dup) return { entry: dup, rec: null };
    if (fast && !anyEntitled(entry.channelId)) throw Object.assign(new Error('No signed-in SiriusXM account can play this channel.'), { code: 'XMRADIO_SIGNED_OUT' });
    if (s.queue.length >= MAX_QUEUE) throw Object.assign(new Error('The recording queue is full.'), { code: 'XMRADIO_REC_QUEUE_FULL' });
    s.queue.push(entry);
    changed();
    await dispatch();
    return { entry, rec: entry.state === 'running' ? recs.get(entry.rid) || null : null };
}

/** What a "now" producer (the deck's REC, one-touch Record) answers: the recording when it started or joined one, else its place in line. */
function nowAnswer({ entry, rec }) {
    if (rec) return describe(rec);
    return { rid: null, queued: true, id: entry.id, position: queueSorted().findIndex((q) => q.id === entry.id) + 1, queue: queuePublic() };
}

/**
 * One-touch Record (the phone's Today item, Yukimi Nov 20 2026): the cut on air now, from its first frame when asked
 * ("Record from the start?" Yes), else from now; it stops when the cut ends.
 */
async function recordCut(channelId, { fromStart } = {}) {
    const cut = xm.nowPlayingCuts(String(channelId || '')).slice(-1)[0];
    const now = Date.now();
    const reach = fromStart && cut && now - cut.at < 4 * 3600 * 1000;
    const at = reach ? cut.at : now;
    return nowAnswer(await submit(makeEntry('cut', channelId, { from: at, fromCut: at, fromNow: !reach, until: now + 2 * 3600 * 1000 }), { fast: true }));
}

/**
 * A tap on Record stacks the song rather than starting it at once (Yukimi, Nov 22 2026). The order is the order the
 * buffer runs out in: a song added now that aired long ago goes ahead of one added earlier that aired later. Songs
 * that expire at the same moment keep the order they were added. The queue lives in the state file, so it survives a
 * Dreamscape or recorder restart, and nothing has to keep a page open.
 */
async function recordRange(channelId, opts = {}) {
    const from = Number(opts.from) || 0;
    const to = Number(opts.to) || 0;
    const now = Date.now();
    if (!from || !to || to <= from || to - from > MAX_MS || from > now + 60000 || from < now - QUEUE_TTL + EXPIRY_MARGIN_MS)
        throw Object.assign(new Error('That song is no longer in the five-hour buffer.'), { code: 'XMRADIO_REC_OLD' });
    if (!xm.channelById(String(channelId || ''))) throw Object.assign(new Error('No such channel.'), { code: 'XMRADIO_CHANNEL' });
    const entry = makeEntry('song', channelId, { from, to, mode: 'range', fromCut: from, a: opts.a, t: opts.t, s: opts.s, ik: opts.ik });
    entry.rangeCut = { at: from, a: entry.a, t: entry.t, s: entry.s, ik: entry.ik, ad: false };
    const r = await submit(entry, { fast: true });
    const running = r.entry.state === 'running';
    return {
        rid: running ? r.entry.rid : null, queued: !running,
        position: running ? 0 : queueSorted().findIndex((q) => q.id === r.entry.id) + 1,
        queue: queuePublic()
    };
}

/**
 * The deck's REC (Yukimi, Nov 21 2026: the desktop asks "record from the start?" as the phone does): the channel until
 * STOP (up to 8 hours), from the first frame of the song or show on air when asked, else from now.
 */
async function recordChannel(channelId, { fromStart } = {}) {
    const cut = xm.nowPlayingCuts(String(channelId || '')).slice(-1)[0];
    const now = Date.now();
    const reach = fromStart && cut && now - cut.at < 4 * 3600 * 1000;
    return nowAnswer(await submit(makeEntry('channel', channelId, { from: reach ? cut.at : now, fromCut: reach ? cut.at : 0, fromNow: !reach }), { fast: true }));
}

/**
 * Start a recording now on the slot the caller names, or the first free one (the socket op `start`; the dispatcher goes
 * through startRec with the slot it chose). The queue is bypassed, the one-stream-per-account rule is not.
 */
async function start(opts) {
    if (shuttingDown) throw Object.assign(new Error('The recorder is handing over to a new process.'), { code: 'XMRADIO_REC_SHUTDOWN' });
    const channelId = String(opts.channelId || '');
    if (!xm.channelById(channelId)) throw Object.assign(new Error('No such channel.'), { code: 'XMRADIO_CHANNEL' });
    const entry = entryFromStart(opts);
    if (opts.slot == null) {
        const cover = coveringRec(entry);
        if (cover) return describe(cover);
    }
    return describe(await startRec(opts, entry));
}

async function startRec(opts, entry) {
    if (shuttingDown) throw Object.assign(new Error('The recorder is handing over to a new process.'), { code: 'XMRADIO_REC_SHUTDOWN' });
    const s = load();
    const channelId = String(opts.channelId || '');
    if (!xm.channelById(channelId)) throw Object.assign(new Error('No such channel.'), { code: 'XMRADIO_CHANNEL' });
    // the slot is the SiriusXM account that streams (S2 of #1252): the dispatcher's choice, or the first free one
    let slot;
    if (opts.slot == null) {
        slot = freeSlots(channelId)[0];
        if (!slot) {
            if (!anyEntitled(channelId)) throw Object.assign(new Error('No signed-in SiriusXM account can play this channel.'), { code: 'XMRADIO_SIGNED_OUT' });
            throw Object.assign(new Error('Every virtual radio is already streaming.'), { code: 'XMRADIO_REC_BUSY' });
        }
    } else {
        slot = Number(opts.slot);
        if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) throw Object.assign(new Error(`There is no recorder slot ${opts.slot}.`), { code: 'XMRADIO_SLOT' });
        for (const r of recs.values()) if (r.meta.channelId === channelId && (r.meta.slot || 1) === slot) return r;
        // SiriusXM allows one stream per account (the deck's streamsPerAccount, default 1): every slot, slot 1 included
        if (streamsOn(slot) >= streamsCap()) throw Object.assign(new Error(`Slot ${slot} is already streaming.`), { code: 'XMRADIO_SLOT_BUSY' });
        if (!slotIsReady(slot)) throw Object.assign(new Error(`Slot ${slot} is not signed in to SiriusXM.`), { code: 'XMRADIO_SIGNED_OUT' });
    }
    // held from here to recs.set, so a second start cannot take the same stream while this one makes its folder
    reserved.set(slot, (reserved.get(slot) || 0) + 1);
    try {
        const rid = id8() + id8();
        const dir = path.join(recRoot(), rid);
        await fs.promises.mkdir(dir, { recursive: true });
        const now = Date.now();
        const back = Math.max(0, Math.min(5 * 3600, Number(opts.back) || 0));
        const meta = {
            rid, channelId, slot, kind: opts.kind || 'manual', ref: opts.ref || null,
            workspaceId: opts.workspaceId || s.deck.workspaceId, tape: opts.tape || s.deck.tape,
            mode: opts.mode || (opts.kind === 'alert' || opts.kind === 'term' || opts.kind === 'song' ? 'song' : s.deck.mode),
            since: now, until: Math.min(now + MAX_MS, Number(opts.until) || now + MAX_MS), startPdt: now - back * 1000, cursor: 0, filed: 0,
            endPdt: Number(opts.endPdt) || 0, rangeCut: opts.rangeCut || null, fromCut: Number(opts.fromCut) || 0
        };
        const rec = { meta, dir, segs: [], gaps: [], cuts: [], lastEnd: 0, write: Promise.resolve(), pump: null, lastSegAt: now };
        // what an assembly needs to know about the recording if the state file no longer does (a restart, a re-assembly days on)
        writeJson(path.join(dir, 'meta.json'), meta).catch(() => {});
        const np = xm.nowPlayingCuts(channelId);
        if (np.length) {
            rec.cuts.push(...np);
            fs.promises.appendFile(path.join(dir, 'cuts.ndjson'), np.map((c) => `${JSON.stringify(c)}\n`).join('')).catch(() => {});
        }
        recs.set(rid, rec);
        // the entry is now a running job, linked to its recording by rid
        const job = entry || entryFromStart(opts);
        job.state = 'running';
        job.rid = rid;
        job.slot = slot;
        job.startedAt = now;
        meta.entryId = job.id;
        if (!s.running.includes(job)) s.running.push(job);
        metaRead.set(channelId, now);
        if (back > 0) metaBackfill(rec, meta.startPdt);
        armMetaTimer();
        rec.pump = makePump(rec, back);
        // song mode starts at the cut in force (an alert's cut from its first frame)
        if (meta.mode === 'song' && opts.fromCut) meta.cursor = opts.fromCut;
        xm.watch('rec', true);
        armStopCheck();
        changed();
        return rec;
    } finally {
        const n = (reserved.get(slot) || 1) - 1;
        if (n > 0) reserved.set(slot, n); else reserved.delete(slot);
    }
}

/** A recording has ended: its entries are done (or, when SiriusXM refused the channel for that account and nothing was
 *  recorded, back in the queue for another slot - each slot refuses a channel once, so this ends). */
function finishEntries(rid, rec) {
    const s = load();
    for (const e of s.running.filter((x) => x.rid === rid)) {
        const slot = rec.meta.slot || 1;
        if (rec.meta.error && !rec.segs.length && !e.attached && (e.tries || 0) < MAX_SLOTS && Date.now() < expOf(e) && !slotEntitled(slot, e.channelId)) {
            s.running = s.running.filter((x) => x !== e);
            e.state = 'queued'; e.slot = null; e.rid = null; e.startedAt = 0; e.tries = (e.tries || 0) + 1;
            s.queue.push(e);
            continue;
        }
        retire(e, 'done', rec.meta.error || '');
    }
}

// ------------------------------------------------------------------ deferred assembly (Yozora #1252 S7)
//
// A recording's segments stay on disk for the whole recording and nothing is filed while it runs. The files (a file per cut in
// song mode, the one chapter file in long mode, the song of a range) are assembled from the segments and the cut store when the
// recording stops, and again on demand (assemble). The job is re-runnable: <recdir>/assembly.json says where it stands, a
// crash mid-assembly is run again when the recorder starts, and a re-run files the same deterministic names - over the earlier
// files on the tape, so it keeps one copy. After a successful assembly the segments are kept for keepSegmentsHours (Re-assemble
// needs them) and then the folder goes; a failed or never-assembled recording keeps them until it is assembled or deleted.
//
//   <recdir>/meta.json      the recording's meta (the state file's `active` entry ends with the recording; this stays)
//   <recdir>/assembly.json  { state: 'assembling' | 'done' | 'failed', at, files: [names], gaps: [{ from, to }], gapSeconds, error }
const ended = new Map(); // rid -> a stopped recording that still holds its segments (and its playlist, ENDLIST)
const assembling = new Map(); // rid -> the assembly in flight
let keepHandle = null;

async function writeJson(file, obj) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(obj));
    await fs.promises.rename(tmp, file);
}
async function readJson(file) {
    try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch (_) { return null; }
}

async function setAssembly(rec, patch) {
    rec.assembly = Object.assign({ state: 'assembling', at: Date.now(), files: [], gaps: [], gapSeconds: 0, error: null }, rec.assembly || {}, patch);
    await writeJson(path.join(rec.dir, 'assembly.json'), rec.assembly);
}

/** Song mode: a file per cut, from where the recording's cut started (an alert's cut from its first frame) to where it ends. */
async function assembleSong(view, opts, note) {
    const first = view.segs[0].pdt;
    const end = view.lastEnd;
    let start = view.meta.cursor || first;
    for (;;) {
        const { cur, next } = cutAt(view, start + 1);
        if (!next || next.at > end) break;
        const from = start;
        await note(() => fileCut(view, cur, from, next.at, !cur || cur.at < first - 1000, opts));
        start = next.at;
        // an alert, a term, or the phone's one-touch Record (kind song) records one cut
        if (oneCutKind(view.meta.kind)) return;
    }
    // what is left after the last whole cut: a partial one
    if (start && end > start) {
        const { cur } = cutAt(view, start + 1);
        const from = start;
        await note(() => fileCut(view, cur, from, end, true, opts));
    }
}

/** Run an assembly (one at a time per recording); resolves with the recording's entry in held(). */
function assemble(rid) {
    if (role === 'library') return Promise.reject(Object.assign(new Error('Assembly runs in the recorder service.'), { code: 'XMRADIO_REC_ROLE' }));
    rid = String(rid || '');
    if (assembling.has(rid)) return assembling.get(rid);
    const rec = recs.get(rid) || ended.get(rid);
    if (!rec) return Promise.reject(Object.assign(new Error('No recording with that id holds segments.'), { code: 'XMRADIO_REC_NONE' }));
    const p = assembleRec(rec).finally(() => { assembling.delete(rid); }).then(() => heldEntry(rec));
    assembling.set(rid, p);
    return p;
}

async function assembleRec(rec) {
    const m = rec.meta;
    // a recording still running is assembled from what is on disk now (its stop assembles it again over these)
    if (!rec.stopping && recs.get(m.rid) === rec) await rec.write;
    const prev = rec.assembly || await readJson(path.join(rec.dir, 'assembly.json'));
    const replace = !!prev;
    const segs = rec.segs.filter((x) => x.ok !== false).slice();
    const view = Object.assign({}, rec, { segs, gaps: (rec.gaps || []).map((g) => ({ from: g.from, to: g.to })), lastEnd: segs.length ? segs[segs.length - 1].pdt + segs[segs.length - 1].dur * 1000 : 0 });
    const gapSeconds = Math.round(view.gaps.reduce((t, g) => t + (g.to - g.from), 0) / 1000);
    await setAssembly(rec, { state: 'assembling', at: Date.now(), files: [], gaps: view.gaps, gapSeconds, error: null });
    changed();
    const files = [];
    const errors = [];
    m.filed = 0; // the tracks are numbered from 1 again
    const note = async (fn) => {
        try { const name = await fn(); if (name) files.push(name); } catch (err) {
            errors.push(err.message);
            console.warn(`[xmRadio rec] ${m.rid}: a file was not assembled: ${err.message}`);
        }
    };
    try {
        // the names the store is being given for a reach-back are in before a cut is sliced (at most a minute)
        if (rec.metaPending) await raceWait(rec.metaPending, 60000);
        if (segs.length) {
            if (m.mode === 'range') await note(() => fileRange(view, { replace }));
            else if (m.mode === 'long') await note(() => fileLong(view, { replace }));
            else await assembleSong(view, { replace }, note);
        }
    } catch (err) { errors.push(err.message); console.warn(`[xmRadio rec] ${m.rid}: ${err.message}`); }
    await setAssembly(rec, { state: errors.length ? 'failed' : 'done', at: Date.now(), files, error: errors.length ? errors.join('; ').slice(0, 500) : null })
        .catch((err) => console.warn(`[xmRadio rec] ${m.rid}: assembly state not written: ${err.message}`));
    if (!recs.has(m.rid)) writeJson(path.join(rec.dir, 'meta.json'), m).catch(() => {});
    armKeep();
    changed();
}

/** When a recording's segments go: keepSegmentsHours after a successful assembly (ten minutes at least: a radio playing the
 *  growing playlist reaches its end). A recording that is running, failed or not yet assembled is kept. */
function keepUntil(rec) {
    const a = rec.assembly;
    if (!a || a.state !== 'done' || recs.get(rec.meta.rid) === rec) return 0;
    const hours = load().settings.keepSegmentsHours;
    return a.at + (rec.segs.length ? Math.max(hours * 3600000, 600000) : 600000);
}

/** One timer (no interval), to the soonest keep expiry. */
function armKeep() {
    clearTimeout(keepHandle);
    keepHandle = null;
    if (role === 'library' || shuttingDown || !st) return;
    let soonest = 0;
    for (const rec of ended.values()) { const k = keepUntil(rec); if (k && (!soonest || k < soonest)) soonest = k; }
    if (!soonest) return;
    keepHandle = setTimeout(() => { keepHandle = null; void sweepExpired(); }, Math.min(Math.max(0, soonest - Date.now()) + 5, 2 ** 31 - 1));
    if (keepHandle.unref) keepHandle.unref();
}

/** Delete the folders whose keep time has passed (at startup, and from the keep timer). */
async function sweepExpired(now = Date.now()) {
    for (const [rid, rec] of [...ended]) {
        const k = keepUntil(rec);
        if (k && now >= k && !assembling.has(rid)) await removeHeld(rid);
    }
    armKeep();
}

/** The operator deletes a recording's segments (a failed or never-assembled one is kept until then); not while it records. */
async function removeHeld(rid) {
    rid = String(rid || '');
    if (recs.has(rid)) throw Object.assign(new Error('That recording is still running: stop it first.'), { code: 'XMRADIO_REC_RUNNING' });
    if (assembling.has(rid)) throw Object.assign(new Error('That recording is being assembled.'), { code: 'XMRADIO_REC_ASSEMBLING' });
    const rec = ended.get(rid);
    ended.delete(rid);
    if (rec) await fs.promises.rm(rec.dir, { recursive: true, force: true }).catch(() => {});
    armKeep();
    changed();
    return { rid, removed: !!rec };
}

/** Recordings that hold segments, newest first: [{ rid, channelId, kind, slot, state, since, endedAt, segs, gaps, gapSeconds, files, error, keepUntil }]. */
function heldEntry(rec) {
    const m = rec.meta;
    const a = rec.assembly;
    let state;
    if (recs.get(m.rid) === rec && !rec.stopping) state = 'recording';
    else if (assembling.has(m.rid)) state = 'assembling';
    else if (!a) state = 'stopped';
    else state = a.state === 'done' ? 'assembled' : a.state === 'failed' ? 'failed' : 'assembling';
    const gaps = (rec.gaps || []).map((g) => ({ from: g.from, to: g.to }));
    return {
        rid: m.rid, channelId: m.channelId, kind: m.kind, slot: m.slot || 1, state, since: m.since || 0, endedAt: m.endedAt || 0,
        segs: rec.segs.length, gaps, gapSeconds: Math.round(gaps.reduce((t, g) => t + (g.to - g.from), 0) / 1000),
        files: a ? a.files || [] : [], error: (a && a.error) || m.error || '', keepUntil: state === 'assembled' ? keepUntil(rec) : 0
    };
}
function held() {
    return [...recs.values(), ...ended.values()].filter((r, i, all) => all.indexOf(r) === i).map(heldEntry).sort((a, b) => (b.since - a.since) || String(a.rid).localeCompare(String(b.rid)));
}
/** The deck's one-line summary of them: a change here tells the console to read held again. */
function heldSummary() {
    let n = 0;
    let assemblingN = 0;
    let failed = 0;
    for (const rec of ended.values()) {
        n += 1;
        const st2 = heldEntry(rec).state;
        if (st2 === 'assembling') assemblingN += 1;
        else if (st2 === 'failed') failed += 1;
    }
    return { n, assembling: assemblingN, failed };
}

async function stop(rid) {
    const rec = recs.get(rid);
    if (!rec || rec.stopping) return null;
    rec.stopping = true;
    try { rec.pump && rec.pump.stop(); } catch (_) { /* stopped */ }
    await rec.write;
    recs.delete(rid);
    finishEntries(rid, rec);
    // it holds its segments from here (the playlist answers, ENDLIST) until it is assembled and its keep time has passed
    rec.meta.endedAt = Date.now();
    rec.ended = rec.meta.endedAt;
    ended.set(rid, rec);
    writeJson(path.join(rec.dir, 'meta.json'), rec.meta).catch(() => {});
    if (!recs.size) { xm.watch('rec', false); stopMetaTimer(); }
    changed();
    // the stream is done: a slot just came free, the next entry in the queue can start while this one is assembled
    void dispatch();
    try { await assemble(rid); } catch (err) { console.warn(`[xmRadio rec] ${rid}: ${err.message}`); }
    return { rid, filed: rec.meta.filed || 0, state: heldEntry(rec).state };
}

function describe(rec) {
    const m = rec.meta;
    const { cur } = cutAt(rec, rec.lastEnd || Date.now());
    return Object.assign({
        rid: m.rid, channelId: m.channelId, slot: m.slot || 1, job: m.entryId || null, kind: m.kind, mode: m.mode, workspaceId: m.workspaceId, tape: m.tape, since: m.since, until: m.until,
        // how far it reached back behind live when it started (s: "from the start" of the song on air)
        back: Math.max(0, Math.round((m.since - (m.startPdt || m.since)) / 1000)),
        filed: m.filed || 0, url: `/api/xmradio/rec/${m.rid}/index.m3u8`,
        cut: cur ? { a: cur.a, t: cur.t, s: cur.s, ad: !!cur.ad } : null,
        // the cuts this recording is split into, from the durable store: what its tape will hold, and how far it has got
        // (a recording's split is the whole point of the metadata store, and it is readable while it still records)
        cuts: splitCuts(rec)
    }, healthOf(rec));
}

/** The cuts a recording covers as its split points: [{ at, a, t, s, ad, done }], oldest first, capped. */
function splitCuts(rec) {
    const first = (rec.meta && rec.meta.startPdt) || (rec.segs && rec.segs[0] && rec.segs[0].pdt) || 0;
    let list;
    try { list = cutsFor(rec); } catch (_) { return []; }
    return list.filter((c) => !first || c.at >= first - 5000).slice(0, 200)
        .map((c) => ({ at: c.at, a: c.a || '', t: c.t || '', s: c.s || '', ad: !!c.ad, done: !!rec.lastEnd && rec.lastEnd >= c.at }));
}

/** The virtual radios as the dispatcher sees them: slot 1..count, signed in or not, and what streams on each. */
function poolView() {
    const out = [];
    for (let n = 1; n <= slotTotal(); n++) {
        const rids = [];
        for (const r of recs.values()) if ((r.meta.slot || 1) === n && !r.stopping) rids.push(r.meta.rid);
        out.push({ slot: n, name: `Lizumi-Recorder-${n}`, ready: slotIsReady(n), streaming: rids.length, rids });
    }
    return out;
}

/**
 * The deck's recording settings, each checked against its range (streamsPerAccount, healthyBuffer, behindSeconds,
 * refetchRetries, keepSegmentsHours); the pumps read them on every tick, the keep timer is set again.
 */
function setSettings(patch = {}) {
    const s = load();
    const next = {};
    for (const [k, [lo, hi]] of Object.entries(SETTING_RANGE)) {
        if (patch[k] == null) continue;
        const n = Number(patch[k]);
        if (!Number.isInteger(n) || n < lo || n > hi) throw Object.assign(new Error(`${SETTING_LABEL[k]} is ${lo} to ${hi}.`), { code: 'XMRADIO_SETTING' });
        next[k] = n;
    }
    Object.assign(s.settings, next);
    if (next.keepSegmentsHours != null) armKeep();
    changed();
    void dispatch();
    return deck();
}

/** A slot's token arrived or was cleared (the auth op), or the slot list changed: a waiting entry may fit now. */
/** A slot's token arrived or went: the pool's readiness changed, so the deck is pushed even when nothing new starts. */
function slotsChanged() { changed(); return dispatch(); }

/** The recording as a growing HLS playlist (EVENT): everything recorded so far stays playable. */
function playlist(rid) {
    const rec = recs.get(rid) || ended.get(rid);
    if (!rec) return null;
    const segs = rec.segs.filter((x) => x.ok !== false);
    const td = Math.ceil(Math.max(10, ...segs.map((x) => x.dur)));
    // players start three segments behind the recording's edge (Yukimi, Nov 21 2026: "at least 1-3 HLS segments
    // behind so that the server is never falling behind and gives time a healthy buffer"); hls.js and ExoPlayer honour it
    const out = ['#EXTM3U', '#EXT-X-VERSION:6', `#EXT-X-TARGETDURATION:${td}`, `#EXT-X-MEDIA-SEQUENCE:${segs.length ? segs[0].seq : 0}`, '#EXT-X-PLAYLIST-TYPE:EVENT'];
    if (recs.has(rid)) out.push(`#EXT-X-START:TIME-OFFSET=-${3 * td},PRECISE=NO`);
    let prev = null;
    for (const s of segs) {
        // a jump in the sequence, or a hole the recording marked (audio that left the stream's window), is a discontinuity
        if (prev && (s.seq !== prev.seq + 1 || (rec.gaps || []).some((g) => g.from >= prev.pdt + prev.dur * 1000 - 1000 && g.to <= s.pdt + 1000))) out.push('#EXT-X-DISCONTINUITY');
        out.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(s.pdt).toISOString()}`, `#EXTINF:${s.dur.toFixed(3)},`, s.f);
        prev = s;
    }
    if (!recs.has(rid)) out.push('#EXT-X-ENDLIST');
    return `${out.join('\n')}\n`;
}

function segPath(rid, f) {
    const rec = recs.get(rid) || ended.get(rid);
    if (!rec || !/^s\d+\.aac$/.test(f)) return null;
    return { root: rec.dir, f };
}

// ------------------------------------------------------------------ auto-record

/** The next start of a timer (ms), or null. Days: 0 = Sunday; none and a date: once. */
function nextStart(t, now = Date.now()) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t.start || ''));
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (t.date) {
        const d = new Date(`${t.date}T00:00:00`);
        if (Number.isNaN(d.getTime())) return null;
        d.setHours(hh, mm, 0, 0);
        return d.getTime() + 60000 > now ? d.getTime() : null;
    }
    const days = Array.isArray(t.days) && t.days.length ? t.days : [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 8; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        d.setHours(hh, mm, 0, 0);
        if (days.includes(d.getDay()) && d.getTime() + 60000 > now) return d.getTime();
    }
    return null;
}

/** The timers whose time has come make entries in the common queue (the dispatcher starts them when a slot is free). */
function fireTimers(now) {
    for (const t of load().timers) {
        if (t.off) continue;
        const at = nextStart(t, now - 60000);
        if (at == null || at > now + 1000 || t.lastRun === at) continue;
        t.lastRun = at;
        if (t.date) t.off = true;
        const to = at + Math.max(1, Math.min(480, Number(t.minutes) || 60)) * 60000;
        const entry = makeEntry('timer', t.channelId, { from: Math.min(at, now), to, ref: t.id, mode: t.mode, tape: t.destination, notify: t.notify, fromNow: true });
        submit(entry).catch((err) => console.warn(`[xmRadio rec] timer ${t.id}: ${err.message}`));
    }
}

function armTimers() {
    clearTimeout(timerHandle);
    timerHandle = null;
    const s = load();
    let soonest = null;
    for (const t of s.timers) {
        if (t.off) continue;
        const at = nextStart(t);
        if (at != null && (soonest == null || at < soonest.at)) soonest = { at, t };
    }
    if (!soonest) return;
    // no more than a day ahead: the clock (and daylight saving) is read again then
    const wait = Math.max(0, Math.min(soonest.at - Date.now(), 24 * 3600 * 1000));
    timerHandle = setTimeout(() => {
        timerHandle = null;
        fireTimers(Date.now());
        changed();
        armTimers();
    }, wait);
    if (timerHandle.unref) timerHandle.unref();
}

function wantsWatch() {
    const s = load();
    return s.alerts.length > 0 || s.terms.length > 0;
}

/**
 * Is the cut on air the one to look at? An ad is never matched, and the stream has to still hold the cut: the buffer
 * keeps five hours, so nothing older than that can be reached back to.
 *
 * A match does not have to be young. A term or alert added while the thing it names is already playing records that
 * cut from its first frame, however long it has been on - the buffer keeps the whole cut (Yukimi, Nov 26 2026: a term
 * for Trancegiving, added 24 minutes into the cut, recorded nothing, because only a cut newer than 15 minutes was
 * ever accepted).
 */
function onAirCut(cur, now) {
    return !!cur && !cur.ad && now - cur.at <= QUEUE_TTL;
}

/** A text rule: nothing wanted passes; else a substring of the words (or the whole words when `exact`). */
function fieldOk(value, wanted, exact) {
    const w = norm(wanted);
    if (!w) return true;
    const v = norm(value);
    return exact ? v === w : v.includes(w);
}

/** The hour window: after (from this hour on) and before (until this hour); after > before wraps past midnight. */
function hourOk(h, after, before) {
    const a = Number.isInteger(after) ? after : null;
    const b = Number.isInteger(before) ? before : null;
    if (a == null && b == null) return true;
    if (a != null && b != null) return a <= b ? (h >= a && h < b) : (h >= a || h < b);
    return a != null ? h >= a : h < b;
}

/** A cut's length in seconds as far as it is known (its own, else the durable store's); 0 until then. */
function cutLength(id, cur) {
    if (Number(cur.dur) > 0) return Number(cur.dur);
    if (!cutStore.isOpen()) return 0;
    try {
        const r = cutStore.cutAt(id, cur.at);
        return r && r.at === cur.at && r.dur ? r.dur : 0;
    } catch (_) { return 0; }
}

/** Does one term's full rule set hold for the cut on air? A rule that is off (the field absent) always holds. */
function termOk(id, cur, t, ctx) {
    if (t.channelId && t.channelId !== id) return false;
    if (ctx.episode && !t.allowShows) return false;
    const hay = norm(`${cur.a} ${cur.t} ${cur.s}`);
    const words = norm(t.text).split(' ').filter(Boolean);
    if (!words.length && !norm(t.artist) && !norm(t.title) && !norm(t.show)) return false;
    if (words.length && !words.every((w) => hay.includes(w))) return false;
    if (!fieldOk(cur.a, t.artist, t.artistExact) || !fieldOk(cur.t, t.title, t.titleExact) || !fieldOk(cur.s, t.show, t.showExact)) return false;
    if (Array.isArray(t.days) && t.days.length && !t.days.includes(new Date(cur.at).getDay())) return false;
    if (!hourOk(new Date(cur.at).getHours(), t.afterHour, t.beforeHour)) return false;
    // only a cut caught within a minute of its start (the default records one that began long ago, from its first frame)
    if (t.fastTrigger && (ctx.now || Date.now()) - cur.at > 60000) return false;
    // the length is not always known while a cut is on air: not a miss, the next read looks again
    if (t.minDuration > 0 && cutLength(id, cur) < t.minDuration) return false;
    return true;
}

/** Which alert or term the cut matches: an alert for its artist (or artist and title), else a term whose rules all
 *  hold (#1252 S5). `id` is the channel's. ctx: { now, episode (cur is a show's episode: allowShows terms only) }. */
function matchOnAir(id, cur, alerts, terms, ctx = {}) {
    if (!ctx.episode) {
        for (const a of alerts) {
            if (a.channelId && a.channelId !== id) continue;
            if (norm(a.artist) !== norm(cur.a)) continue;
            if (a.kind === 'song' && norm(a.title) !== norm(cur.t)) continue;
            return a.destination ? { kind: 'alert', ref: a.id, tape: a.destination } : { kind: 'alert', ref: a.id };
        }
    }
    for (const t of terms) {
        if (termOk(id, cur, t, ctx)) return Object.assign({ kind: 'term', ref: t.id }, t.destination ? { tape: t.destination } : {}, t.notify ? { notify: true } : {});
    }
    return null;
}

/** Every channel's cuts after a lookAround read: the recordings' splits, alerts and terms. */
function onLook(channelCuts) {
    metaLook(channelCuts);
    for (const rec of recs.values()) {
        const cuts = channelCuts.get(rec.meta.channelId);
        if (cuts) noteCuts(rec, cuts);
    }
    const s = load();
    if (!s.alerts.length && !s.terms.length) return;
    const now = Date.now();
    for (const [id, cuts] of channelCuts) {
        const cur = cuts[cuts.length - 1];
        if (!onAirCut(cur, now)) continue;
        const key = `${id}|${cur.at}`;
        if (fired.has(key)) continue;
        const ch = xm.channelById(id);
        if (!ch || ch.sub === false) continue;
        const hit = matchOnAir(id, cur, s.alerts, s.terms, { now });
        if (!hit) continue;
        fired.add(key);
        if (fired.size > 2000) fired.delete(fired.values().next().value);
        // an alert or term records the matching cut from its first frame: it queues, and reaches back when a slot takes it
        submit(makeEntry(hit.kind, id, { from: cur.at, fromCut: cur.at, until: now + 2 * 3600 * 1000, ref: hit.ref, tape: hit.tape, notify: hit.notify, a: cur.a, t: cur.t, s: cur.s, ik: cur.ik }))
            .catch((err) => console.warn(`[xmRadio rec] ${hit.kind} ${hit.ref}: ${err.message}`));
    }
    matchEpisodes(channelCuts, s, now);
}

/** A show's episode on air, for the terms that allow shows (the store keeps the episodes lookAround does not carry). */
function matchEpisodes(channelCuts, s, now) {
    if (!s.terms.some((t) => t.allowShows) || !cutStore.isOpen()) return;
    for (const id of channelCuts.keys()) {
        const ch = xm.channelById(id);
        if (!ch || ch.sub === false) continue;
        let eps;
        try { eps = cutStore.cutsBetween(id, now, 0).filter((r) => r.isEpisode && r.at <= now && (!r.end || r.end > now)); } catch (_) { continue; }
        const ep = eps[eps.length - 1];
        if (!ep || !ep.title) continue;
        const key = `${id}|ep|${ep.at}`;
        if (fired.has(key)) continue;
        const hit = matchOnAir(id, { at: ep.at, a: '', t: ep.title, s: ep.title, dur: ep.dur }, [], s.terms, { now, episode: true });
        if (!hit) continue;
        fired.add(key);
        submit(makeEntry(hit.kind, id, { from: ep.at, fromCut: ep.at, until: now + 2 * 3600 * 1000, ref: hit.ref, tape: hit.tape, notify: hit.notify, t: ep.title, s: ep.title }))
            .catch((err) => console.warn(`[xmRadio rec] ${hit.kind} ${hit.ref}: ${err.message}`));
    }
}

// ------------------------------------------------------------------ the deck's settings

function deck() {
    const s = load();
    return {
        tape: s.deck.tape, workspaceId: s.deck.workspaceId, mode: s.deck.mode,
        recordings: [...recs.values()].map(describe),
        timers: s.timers, alerts: s.alerts, terms: s.terms,
        // the common queue (#1252 S3): waiting entries in due order, started ones, the last 100 that ended, the virtual radios
        queue: queuePublic(), jobs: jobsPublic(), history: s.history.map((e) => entryPublic(e, 0)),
        settings: Object.assign({}, s.settings), pool: poolView(), held: heldSummary()
    };
}

function setDeck({ tape, workspaceId, mode } = {}) {
    const s = load();
    if (tape != null) { const t = safeName(tape, 80); if (!t) throw new Error('Name the tape.'); s.deck.tape = t; }
    if (workspaceId != null) s.deck.workspaceId = String(workspaceId).slice(0, 80) || 'default';
    if (mode === 'song' || mode === 'long') s.deck.mode = mode;
    changed();
    return deck();
}

/** A destination tape's name as a rule stores it: a safe folder name, or null for the deck's own tape. */
function tapeOf(v) {
    return safeName(v, 80) || null;
}

/** An hour 0-23, or null when the rule is off. */
function hourOf(v) {
    if (v == null || v === '') return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 23 ? n : null;
}

function setTimers(list) {
    const s = load();
    s.timers = (Array.isArray(list) ? list : []).slice(0, 50).filter((t) => t && xm.channelById(String(t.channelId || ''))).map((t) => ({
        id: /^[0-9a-f]{12}$/.test(t.id) ? t.id : id8(),
        channelId: String(t.channelId),
        start: /^\d{1,2}:\d{2}$/.test(t.start) ? t.start : '08:00',
        minutes: Math.max(1, Math.min(480, Math.round(Number(t.minutes) || 60))),
        days: Array.isArray(t.days) ? [...new Set(t.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [],
        date: /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? t.date : null,
        mode: t.mode === 'song' || t.mode === 'long' ? t.mode : null,
        destination: tapeOf(t.destination),
        notify: !!t.notify,
        off: !!t.off
    }));
    armTimers();
    changed();
    return s.timers;
}

function addAlert({ kind, artist, title, channelId, destination } = {}) {
    const s = load();
    const a = { id: id8(), kind: kind === 'song' ? 'song' : 'artist', artist: String(artist || '').slice(0, 200), title: kind === 'song' ? String(title || '').slice(0, 200) : '', channelId: channelId ? String(channelId) : null, destination: tapeOf(destination) };
    if (!a.artist) throw new Error('Nothing is playing to set an alert for.');
    const had = s.alerts.find((x) => x.kind === a.kind && norm(x.artist) === norm(a.artist) && norm(x.title) === norm(a.title));
    if (had) {
        // the same alert again only moves its destination (the console's Properties)
        if (destination !== undefined && (had.destination || null) !== a.destination) { had.destination = a.destination; changed(); }
        return s.alerts;
    }
    s.alerts.push(a);
    if (s.alerts.length > 100) s.alerts.shift();
    xm.watch('match', wantsWatch());
    changed();
    return s.alerts;
}

function removeAlert(id) {
    const s = load();
    s.alerts = s.alerts.filter((a) => a.id !== id);
    xm.watch('match', wantsWatch());
    changed();
    return s.alerts;
}

function setTerms(list) {
    const s = load();
    // every field past text and channel is optional and off by default (#1252 S5); anything else is dropped
    const str = (v) => String(v || '').trim().slice(0, 120);
    s.terms = (Array.isArray(list) ? list : []).slice(0, 50).map((x) => {
        const t = x || {};
        return {
            id: /^[0-9a-f]{12}$/.test(t.id) ? t.id : id8(),
            text: str(t.text),
            channelId: t.channelId ? String(t.channelId) : null,
            artist: str(t.artist), artistExact: !!t.artistExact,
            title: str(t.title), titleExact: !!t.titleExact,
            show: str(t.show), showExact: !!t.showExact,
            days: Array.isArray(t.days) ? [...new Set(t.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [],
            afterHour: hourOf(t.afterHour), beforeHour: hourOf(t.beforeHour),
            minDuration: Math.max(0, Math.min(86400, Math.round(Number(t.minDuration) || 0))),
            allowShows: !!t.allowShows, fastTrigger: !!t.fastTrigger, notify: !!t.notify,
            destination: tapeOf(t.destination)
        };
    }).filter((t) => norm(t.text) || norm(t.artist) || norm(t.title) || norm(t.show));
    xm.watch('match', wantsWatch());
    changed();
    return s.terms;
}

// ------------------------------------------------------------------ boot

/**
 * A signal (pm2 restart / stop) hands this process over to a new one (Yukimi, Nov 22 2026): stop pulling segments,
 * let the one on the wire finish writing, and store the exact next segment in each recording's meta. The active
 * recordings and the queue stay in the state file, so the new process carries on each one as the same recording at
 * the next segment - no half segment, no gap, no repeat.
 */
async function shutdown() {
    if (role === 'library') return { recordings: 0, queue: 0 };
    shuttingDown = true;
    const live = [...recs.values()];
    // stop() waits for a segment already being fetched; a stuck fetch must not hold the handoff (pm2's kill timeout)
    await Promise.all(live.map(async (rec) => {
        try { if (rec.pump) await Promise.race([rec.pump.stop(), delay(3000)]); } catch (_) { /* best effort */ }
    }));
    // every segment that landed is on disk before the state file and this process go away
    await Promise.race([Promise.all(live.map((r) => r.write.catch(() => {}))), delay(3000)]);
    for (const rec of live) {
        rec.meta.resumeAt = rec.lastEnd || rec.meta.resumeAt || rec.meta.startPdt;
        const last = rec.segs[rec.segs.length - 1];
        rec.meta.resumeSeq = last ? last.seq + 1 : null;
    }
    stopMetaTimer();
    clearTimeout(stopCheckHandle);
    stopCheckHandle = null;
    clearTimeout(expiryHandle);
    expiryHandle = null;
    clearTimeout(keepHandle);
    keepHandle = null;
    // an assembly still running is run again by the next process (its assembly.json says 'assembling')
    // the cut store is on disk with the state file
    if (cutStore.isOpen()) await Promise.race([cutStore.flush().catch(() => {}), delay(3000)]);
    saveNow();
    return { recordings: live.length, queue: (load().queue || []).length, running: (load().running || []).length };
}

/** A resumed recording's entry (one from before the common queue has none): linked by rid, running. */
function adoptEntry(meta) {
    const s = load();
    let e = s.running.find((x) => x.id === meta.entryId || x.rid === meta.rid);
    // a one-cut recording from before S3 kept its cut only as the song-mode cursor (a term matched again after the restart
    // queued the same cut a second time, Nov 26 2026)
    if (!meta.fromCut && meta.cursor && (meta.kind === 'song' || meta.kind === 'alert' || meta.kind === 'term')) meta.fromCut = meta.cursor;
    if (!e) {
        e = entryFromStart({ channelId: meta.channelId, kind: meta.kind, mode: meta.mode, back: Math.round(((meta.since || Date.now()) - (meta.startPdt || meta.since || Date.now())) / 1000), endPdt: meta.endPdt, until: meta.until, fromCut: meta.fromCut, ref: meta.ref, rangeCut: meta.rangeCut });
        s.running.push(e);
    }
    e.state = 'running';
    e.rid = meta.rid;
    e.slot = meta.slot || 1;
    e.startedAt = e.startedAt || meta.since || Date.now();
    meta.entryId = e.id;
}

/** What a recording folder holds: its segments, the holes between them, and the cuts lookAround gave it. */
async function readRecDisk(dir) {
    const out = { segs: [], gaps: [], cuts: [] };
    try {
        for (const l of (await fs.promises.readFile(path.join(dir, 'segs.ndjson'), 'utf8')).split('\n')) {
            if (!l) continue;
            let row;
            try { row = JSON.parse(l); } catch (_) { continue; } // a half-written last line
            if (row.gap) out.gaps.push({ from: row.from, to: row.to });
            else out.segs.push(Object.assign(row, { ok: true }));
        }
    } catch (_) { /* nothing recorded */ }
    // a hole whose audio is held after all (a resumed recording fetched it again) is no hole: its silence would be added
    out.gaps = out.gaps.filter((g) => out.segs.reduce((t, x) => t + Math.max(0, Math.min(g.to, x.pdt + x.dur * 1000) - Math.max(g.from, x.pdt)), 0) < (g.to - g.from) - 1000);
    try { out.cuts = (await fs.promises.readFile(path.join(dir, 'cuts.ndjson'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.at - b.at); } catch (_) { /* none */ }
    return out;
}

/**
 * At startup: the folders no running recording owns. A folder with meta.json is a stopped recording that holds its segments:
 * one whose assembly was done or failed is kept (until its keep time, or the operator deletes it); one that never finished
 * assembling (a crash, a hard stop) is assembled now. Anything else (an older folder, a crash before the recording began) goes.
 */
async function sweepHeld() {
    let dirs = [];
    try { dirs = await fs.promises.readdir(recRoot()); } catch (_) { return; }
    for (const d of dirs) {
        if (recs.has(d) || ended.has(d)) continue;
        const dir = path.join(recRoot(), d);
        const meta = await readJson(path.join(dir, 'meta.json'));
        if (!meta || meta.rid !== d) { fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); continue; }
        const disk = await readRecDisk(dir);
        const assembly = await readJson(path.join(dir, 'assembly.json'));
        if (!disk.segs.length && !assembly) { fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); continue; }
        const last = disk.segs[disk.segs.length - 1];
        const rec = { meta, dir, segs: disk.segs, gaps: disk.gaps, cuts: disk.cuts, lastEnd: last ? last.pdt + last.dur * 1000 : 0, write: Promise.resolve(), pump: null, stopping: true, assembly, ended: meta.endedAt || 0 };
        ended.set(d, rec);
        if (!assembly || assembly.state === 'assembling') {
            console.log(`[xmRadio rec] ${d}: ${assembly ? 'an assembly was cut short' : 'never assembled'}; assembling it now`);
            void assemble(d).catch((err) => console.warn(`[xmRadio rec] ${d}: ${err.message}`));
        }
    }
    await sweepExpired();
}

/** Recordings left by a stopped server: assemble what cannot carry on, carry on those whose time is not up. */
async function resume() {
    const s = load();
    const left = s.active || [];
    s.active = [];
    for (const meta of left) {
        if (recs.has(meta.rid)) continue;
        const dir = path.join(recRoot(), meta.rid);
        const disk = await readRecDisk(dir);
        const last = disk.segs[disk.segs.length - 1];
        const rec = { meta, dir, segs: disk.segs, gaps: disk.gaps, cuts: disk.cuts, lastEnd: last ? last.pdt + last.dur * 1000 : 0, write: Promise.resolve(), pump: null, lastSegAt: Date.now() };
        if (meta.written == null) meta.written = rec.segs.length;
        recs.set(meta.rid, rec);
        adoptEntry(meta);
        // it carries on as the same recording (Yukimi, Nov 21 2026: a recording must never stop because a server did):
        // a graceful handoff stored the exact next segment, a hard stop falls back to the last one on disk. The pump
        // reads from there, the stream keeps five hours, so the time the process was down is recorded too.
        const stored = !!meta.resumeAt;
        const anchor = meta.resumeAt || rec.lastEnd;
        const gap = anchor ? Math.ceil((Date.now() - anchor) / 1000) + 2 : Math.ceil((Date.now() - meta.startPdt) / 1000);
        const due = (meta.until && Date.now() >= meta.until - 5000) || (rec.lastEnd && rec.lastEnd - meta.startPdt >= MAX_MS);
        // one that cannot carry on is assembled, not just filed (the assembly runs on its own: the others resume meanwhile)
        if (due || gap > 5 * 3600 - 300 || !xm.channelById(meta.channelId)) { void stop(meta.rid); continue; }
        // the pump carries on exactly at the end of what is on disk: audio gone from the stream's window since is a gap
        rec.pump = makePump(rec, Math.max(0, gap), rec.lastEnd || 0);
        if (gap > 0) metaBackfill(rec, Date.now() - gap * 1000);
        delete meta.resumeAt; delete meta.resumeSeq;
        console.log(`[xmRadio rec] ${meta.rid}: resumed (${meta.kind}, ${gap} s to catch up${stored ? ', at the stored segment' : ''})`);
    }
    if (recs.size) { xm.watch('rec', true); armMetaTimer(); armStopCheck(); }
    // a started entry whose recording is not back has ended with the process
    for (const e of s.running.slice()) if (!recs.has(e.rid)) retire(e, 'done', 'Ended while the recorder was down');
    changed();
    // the queue lives in the state file: pick it up again after a recorder restart (the resumed recordings hold their
    // slots; what waits starts as they free, and entries that ran out of buffer meanwhile are missed)
    void dispatch();
    await sweepHeld();
}

let booted = false;
function init(xmRadio, globalResources, opts = {}) {
    xm = xmRadio;
    gr = globalResources;
    role = 'capture';
    if (opts.changed) onChange = opts.changed;
    if (opts.spooled) onSpool = opts.spooled;
    if (booted) return module.exports;
    booted = true;
    load();
    armTimers();
    xm.watch('match', wantsWatch());
    xm.onLook(onLook);
    // a slot signing in or out (or the slot count changing) may let a waiting entry start
    if (typeof xm.onSlots === 'function') xm.onSlots(() => { void dispatch(); });
    armExpiry();
    setTimeout(() => { resume().catch((err) => console.warn(`[xmRadio rec] resume: ${err.message}`)); }, role === 'capture' && opts.resumeMs != null ? opts.resumeMs : 15000).unref?.();
    return module.exports;
}

/** Dreamscape's copy: the tapes and their files only (the recording itself runs in the service). */
function library(xmRadio, globalResources) {
    xm = xmRadio;
    gr = globalResources;
    role = 'library';
    return module.exports;
}

/** The service: a tape was renamed in Dreamscape (the deck and the recordings on it follow). */
function tapeRenamed(workspaceId, from, to) {
    const s = load();
    if (s.deck.workspaceId === workspaceId && s.deck.tape === from) s.deck.tape = to;
    for (const r of recs.values()) if (r.meta.workspaceId === workspaceId && r.meta.tape === from) r.meta.tape = to;
    changed();
    return deck();
}

module.exports = {
    init, library, tapeRenamed, saveNow, shutdown, importSpool, spoolList, spoolDir: () => spoolDir(), recRoot: () => recRoot(), start, stop, recordCut, recordChannel, recordRange, queueList: queuePublic, queueRemove, queueClear, cancel, setSettings, slotsChanged, dispatch, assemble, held, heldDelete: removeHeld, tapesInfo, trackPath, trackRename, trackDelete, trackMove, tapeNew, tapeRename, tapeDelete, deck, setDeck, setTimers, addAlert, removeAlert, setTerms, tapes, tracks, playlist, segPath,
    _test: { adtsFrames, nextStart, cutAt, norm, onLook, onAirCut, matchOnAir, sliceAac, silenceFrame, recs, ended, assembling, resume, sweepExpired, armKeep, keepArmed: () => !!keepHandle, stopCheck, stopCheckArmed: () => !!stopCheckHandle, readRecDisk, fireTimers, makeEntry, freeSlots, load: () => load(), reset: () => { st = null; clearTimeout(expiryHandle); expiryHandle = null; reserved.clear(); stopMetaTimer(); cutStore._test.reset(''); recs.clear(); ended.clear(); assembling.clear(); clearTimeout(keepHandle); keepHandle = null; fired.clear(); shuttingDown = false; } }
};
