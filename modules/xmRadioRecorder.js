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
 * running when the server stopped is finished into its tape when it starts again, and carries on if its time is not up.
 *
 * Files: <cache>/xmradio-recorder.json (the deck, timers, alerts, terms, recordings in progress);
 *        <cache>/xmradio-rec/<rid>/ (the recording's decrypted segments, segs.ndjson, cuts.ndjson) until it is filed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cutStore = require('./xmRadioMeta');

const MAX_MS = 8 * 3600 * 1000;
const RECORDINGS = 'Recordings';
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
    st.settings = Object.assign({ streamsPerAccount: 1 }, st.settings || {});
    const per = Number(st.settings.streamsPerAccount);
    st.settings.streamsPerAccount = Number.isInteger(per) && per >= 1 && per <= 4 ? per : 1;
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

/** The ADTS frames in a buffer: [{ off, len, sr }] (each 1024 samples). */
function adtsFrames(buf) {
    const out = [];
    let off = 0;
    while (off + 7 <= buf.length) {
        if (buf[off] !== 0xff || (buf[off + 1] & 0xf6) !== 0xf0) { off += 1; continue; }
        const len = ((buf[off + 3] & 0x03) << 11) | (buf[off + 4] << 3) | (buf[off + 5] >> 5);
        if (len < 7 || off + len > buf.length) break;
        out.push({ off, len, sr: SR[(buf[off + 2] >> 2) & 0x0f] || 44100 });
        off += len;
    }
    return out;
}

/** The AAC of [from, to) (ms, the stream's own clock) out of a recording's segments, cut at whole frames. */
async function sliceAac(rec, from, to, outFile) {
    const fh = await fs.promises.open(outFile, 'w');
    let bytes = 0;
    try {
        for (const sg of rec.segs) {
            const end = sg.pdt + sg.dur * 1000;
            if (end <= from || sg.pdt >= to) continue;
            const id3 = await fs.promises.readFile(path.join(rec.dir, sg.f));
            const buf = require('./xmRadioPump')._test.stripId3(id3);
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

/** A tape's recordings in order: [{ id, name, size, at, dur (s) }]. */
async function tracks(workspaceId, name) {
    const f = await tapeFolder(workspaceId, name, false);
    if (!f) return [];
    const db = require('./vfsDatabase');
    const files = await db.getUserFilesByLocation('workspace', workspaceId, f.id);
    const list = (files || []).filter((x) => !x.trashed_at && /\.(m4a|aac|mp3)$/i.test(x.original_name || ''))
        .sort((a, b) => String(a.original_name).localeCompare(String(b.original_name), undefined, { numeric: true }));
    const out = [];
    for (const x of list) out.push({ id: x.id, name: x.original_name, size: x.size, at: x.created_at, dur: await durationOf(x.content_hash) });
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

async function fileInto(rec, tmpPath, name) {
    if (role === 'capture') {
        // the service: into the spool, Dreamscape files it on the tape (now, or when it is back)
        const id = id8() + id8();
        const dir = spoolDir();
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.rename(tmpPath, path.join(dir, `${id}.m4a`)).catch(async () => { await fs.promises.copyFile(tmpPath, path.join(dir, `${id}.m4a`)); });
        // the description last: a spool entry counts once its .json is there
        await fs.promises.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ workspaceId: rec.meta.workspaceId, tape: rec.meta.tape, name, at: Date.now(), rid: rec.meta.rid }));
        rec.meta.filed = (rec.meta.filed || 0) + 1;
        try { onSpool(id); } catch (_) { /* told on the next connect */ }
        return `${name}.m4a`;
    }
    rec.meta.filed = (rec.meta.filed || 0) + 1;
    return saveToTape(rec.meta.workspaceId, rec.meta.tape, tmpPath, name);
}

/** A finished recording into its tape's folder (a free name), the folder's viewers told. Dreamscape only. */
async function saveToTape(workspaceId, tape, tmpPath, name) {
    const folder = await tapeFolder(workspaceId, tape, true);
    const v = await vfs();
    const db = require('./vfsDatabase');
    const used = new Set(((await db.getUserFilesByLocation('workspace', workspaceId, folder.id)) || []).map((x) => String(x.original_name || '').toLowerCase()));
    let n = `${name}.m4a`;
    for (let i = 2; used.has(n.toLowerCase()); i += 1) n = `${name} (${i}).m4a`;
    await v.saveUserFileFromPath(tmpPath, { originalName: n, mimeType: 'audio/mp4', scope: 'workspace', workspaceId, folderId: folder.id });
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
    await saveToTape(meta.workspaceId || 'default', meta.tape || 'Tape 1', m4a, String(meta.name || 'Recording'));
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

/** Write one cut (song mode) to the tape: [from, to). */
async function fileCut(rec, cut, from, to, partial) {
    if (to - from < 5000) return; // a cut the recording only grazed
    const ch = channelOf(rec.meta.channelId);
    const tmp = path.join(rec.dir, `cut-${from}.aac`);
    const out = path.join(rec.dir, `cut-${from}.m4a`);
    const bytes = await sliceAac(rec, from, to, tmp);
    if (bytes < 4096) { fs.promises.rm(tmp, { force: true }).catch(() => {}); return; }
    const title = cut && !cut.ad && cut.t ? cut.t : (cut && cut.s) || ch.name;
    const artist = cut && !cut.ad && cut.a ? cut.a : ch.name;
    const cover = cut && !cut.ad ? await coverFile(rec, cut.ik) : null;
    const when = new Date(from);
    const args = ['-f', 'aac', '-i', tmp];
    if (cover) args.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    args.push('-c:a', 'copy', '-bsf:a', 'aac_adtstoasc',
        '-metadata', `title=${title}${partial ? ' (partial)' : ''}`, '-metadata', `artist=${artist}`,
        '-metadata', `album=${ch.number ? `${ch.number} ` : ''}${ch.name}`, '-metadata', `date=${localDate(when)}`,
        '-metadata', `comment=Recorded from SiriusXM ${ch.name} on ${when.toISOString()}${cut && cut.s ? `; show: ${cut.s}` : ''}`,
        '-metadata', `track=${(rec.meta.filed || 0) + 1}`,
        '-movflags', '+faststart', out);
    try {
        await ffmpeg(args);
        const stamp = `${pad2(when.getHours())}${pad2(when.getMinutes())}`;
        const name = safeName(`${localDate(when)} ${stamp} ${artist === ch.name ? title : `${artist} - ${title}`}`);
        await fileInto(rec, out, name);
    } catch (err) {
        console.warn(`[xmRadio rec] ${rec.meta.rid}: a cut was not filed: ${err.message}`);
    } finally {
        fs.promises.rm(tmp, { force: true }).catch(() => {});
        fs.promises.rm(out, { force: true }).catch(() => {});
    }
}

/**
 * A range from the buffer (Recently Played > Record): one file for that song. It is filed from the packet's data, not
 * from lookAround's short cut history, so the name and cover survive however old the song is.
 */
async function fileRange(rec) {
    if (!rec.segs.length || !rec.meta.rangeCut) return;
    const from = rec.meta.rangeCut.at;
    const to = Math.min(rec.meta.endPdt || rec.lastEnd, rec.lastEnd);
    if (to <= from) return;
    await fileCut(rec, rec.meta.rangeCut, from, to, !!rec.meta.endPdt && rec.lastEnd < rec.meta.endPdt - 2000);
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Write the whole recording (long mode) as one file with a chapter per cut. */
async function fileLong(rec) {
    if (!rec.segs.length) return;
    const ch = channelOf(rec.meta.channelId);
    const from = rec.segs[0].pdt;
    const last = rec.segs[rec.segs.length - 1];
    const to = last.pdt + last.dur * 1000;
    const tmp = path.join(rec.dir, 'long.aac');
    const out = path.join(rec.dir, 'long.m4a');
    const meta = path.join(rec.dir, 'long.txt');
    if ((await sliceAac(rec, from, to, tmp)) < 4096) return;
    const when = new Date(from);
    const lines = [';FFMETADATA1', `title=${ffMetaEsc(`${ch.name}, ${when.toLocaleString('en-US')}`)}`, `artist=${ffMetaEsc(ch.name)}`, `album=${ffMetaEsc(ch.name)}`, `date=${localDate(when)}`];
    const cuts = cutsFor(rec).filter((c) => c.at < to);
    cuts.forEach((c, i) => {
        const s = Math.max(0, c.at - from);
        const e = Math.min(to, (cuts[i + 1] ? cuts[i + 1].at : to)) - from;
        if (e <= s) return;
        lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(s)}`, `END=${Math.round(e)}`, `title=${ffMetaEsc(c.ad ? (c.s || 'Break') : [c.a, c.t].filter(Boolean).join(' - ') || c.s || ch.name)}`);
    });
    await fs.promises.writeFile(meta, `${lines.join('\n')}\n`);
    try {
        await ffmpeg(['-f', 'aac', '-i', tmp, '-i', meta, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', out]);
        await fileInto(rec, out, safeName(`${localDate(when)} ${pad2(when.getHours())}${pad2(when.getMinutes())} ${ch.name}`));
    } catch (err) {
        console.warn(`[xmRadio rec] ${rec.meta.rid}: not filed: ${err.message}`);
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
    for (const r of recs.values()) if (r.meta.channelId === channelId) void fileFinishedCuts(r);
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

/** Song mode: file every cut that the recording has passed the end of. */
async function fileFinishedCuts(rec) {
    if (rec.meta.mode !== 'song' || rec.filing) return;
    rec.filing = true;
    try {
        // the names the store is being given for a reach-back are in before any cut is sliced
        // (at most a minute: a slow liveUpdate must not hold the tape back; lookAround's names stand in)
        if (rec.metaPending) await Promise.race([rec.metaPending, delay(60000)]);
        const recEnd = rec.lastEnd;
        // every segment up to there on disk before a cut is sliced from them
        await rec.write;
        for (;;) {
            const start = rec.meta.cursor || (rec.segs[0] && rec.segs[0].pdt) || 0;
            const { cur, next } = cutAt(rec, start + 1);
            if (!next || next.at > recEnd) break;
            await fileCut(rec, cur, start, next.at, !cur || cur.at < (rec.segs[0] && rec.segs[0].pdt) - 1000);
            rec.meta.cursor = next.at;
            rec.meta.cuts = (rec.meta.cuts || 0) + 1;
            changed();
            // an alert or a term records one cut
            // an alert, a term, or the phone's one-touch Record (kind song) records one cut
            if (rec.meta.kind === 'alert' || rec.meta.kind === 'term' || rec.meta.kind === 'song') { void stop(rec.meta.rid, { filed: true }); break; }
        }
    } finally { rec.filing = false; }
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
    const f = `s${sg.seq}.aac`;
    const row = { seq: sg.seq, pdt: sg.pdt, dur: sg.dur, f, ok: false };
    rec.segs.push(row);
    rec.lastEnd = sg.pdt + sg.dur * 1000;
    rec.write = rec.write.then(async () => {
        await fs.promises.writeFile(path.join(rec.dir, f), sg.plain);
        await fs.promises.appendFile(path.join(rec.dir, 'segs.ndjson'), `${JSON.stringify({ seq: row.seq, pdt: row.pdt, dur: row.dur, f })}\n`);
        // listed in the playlist only now that its file is there (a listener near the edge asked for a segment still
        // being written and stalled)
        row.ok = true;
    }).catch((err) => console.warn(`[xmRadio rec] ${rec.meta.rid}: ${err.message}`));
    if (rec.lastEnd - rec.meta.startPdt >= MAX_MS || (rec.meta.until && Date.now() >= rec.meta.until) || (rec.meta.endPdt && rec.lastEnd >= rec.meta.endPdt)) { void stop(rec.meta.rid); return; }
    void fileFinishedCuts(rec);
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
    void fileFinishedCuts(rec);
    changed();
}

function makePump(rec, back) {
    const pump = require('./xmRadioPump').createPump({
        channelId: rec.meta.channelId, quality: 'hi',
        // the recording's own SiriusXM account (its slot; none = slot 1, the radio's account)
        keyBytes: (uri) => xm.keyBytes(uri, { slot: rec.meta.slot || 1 }),
        tune: async (id) => xm.tuneUpstream(id, { slot: rec.meta.slot || 1 }),
        log: (lvl, t) => console.warn(t),
        // a recording keeps trying through a missing sign-in (the token comes from Dreamscape)
        persistent: true
    });
    pump.on('segment', (sg) => appendSeg(rec, sg));
    pump.on('error', (err) => { rec.meta.error = err.message; void stop(rec.meta.rid); });
    pump.start({ back });
    return pump;
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
const MAX_STREAMS = 4;
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
        mode: o.mode || null, fromCut: Number(o.fromCut) || 0, fromNow: !!o.fromNow,
        a: String(o.a || '').slice(0, 200), t: String(o.t || '').slice(0, 200), s: String(o.s || '').slice(0, 200), ik: String(o.ik || '').slice(0, 200),
        rangeCut: o.rangeCut || null, ref: o.ref || null, addedAt: now, expiresAt: from + BUFFER_MS - EXPIRY_MARGIN_MS,
        state: 'queued', slot: null, rid: null, startedAt: 0, endedAt: 0, reason: ''
    };
}

/** The opts startRec takes for an entry, worked out at the moment it starts (so a late start reaches back to `from`). */
function startOpts(e, now, slot) {
    const kind = e.kind || 'song';
    const o = { channelId: e.channelId, slot, kind: REC_KIND[kind] || 'manual', ref: e.ref || null, mode: e.mode || undefined };
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
    a: q.a || '', t: q.t || '', s: q.s || '', ik: q.ik || '', mode: q.mode || null, ref: q.ref || null,
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
            if (oneCut && ((e.fromCut && e.fromCut === m.fromCut) || (kind === 'cut' && e.fromNow))) return rec;
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
        const rec = { meta, dir, segs: [], cuts: [], lastEnd: 0, write: Promise.resolve(), pump: null, filing: false };
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

async function stop(rid, { filed } = {}) {
    const rec = recs.get(rid);
    if (!rec || rec.stopping) return null;
    rec.stopping = true;
    try { rec.pump && rec.pump.stop(); } catch (_) { /* stopped */ }
    await rec.write;
    try {
        if (rec.meta.mode === 'range') await fileRange(rec);
        else if (rec.meta.mode === 'long') await fileLong(rec);
        else if (!filed) {
            await fileFinishedCuts(rec);
            const from = rec.meta.cursor || (rec.segs[0] && rec.segs[0].pdt);
            if (from && rec.lastEnd > from) { const { cur } = cutAt(rec, from + 1); await fileCut(rec, cur, from, rec.lastEnd, true); }
        }
    } catch (err) { console.warn(`[xmRadio rec] ${rid}: ${err.message}`); }
    recs.delete(rid);
    finishEntries(rid, rec);
    // the playlist answers a little longer (a radio playing it reaches its end), then the segments go
    rec.ended = Date.now();
    ended.set(rid, rec);
    setTimeout(() => { ended.delete(rid); fs.promises.rm(rec.dir, { recursive: true, force: true }).catch(() => {}); }, 10 * 60 * 1000).unref?.();
    if (!recs.size) { xm.watch('rec', false); stopMetaTimer(); }
    changed();
    // a slot just came free: the next entry in the queue can start
    void dispatch();
    return { rid, filed: rec.meta.filed || 0 };
}
const ended = new Map();

function describe(rec) {
    const m = rec.meta;
    const { cur } = cutAt(rec, rec.lastEnd || Date.now());
    return {
        rid: m.rid, channelId: m.channelId, slot: m.slot || 1, job: m.entryId || null, kind: m.kind, mode: m.mode, workspaceId: m.workspaceId, tape: m.tape, since: m.since, until: m.until,
        // how far it reached back behind live when it started (s: "from the start" of the song on air)
        back: Math.max(0, Math.round((m.since - (m.startPdt || m.since)) / 1000)),
        filed: m.filed || 0, url: `/api/xmradio/rec/${m.rid}/index.m3u8`,
        cut: cur ? { a: cur.a, t: cur.t, s: cur.s, ad: !!cur.ad } : null
    };
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

/** The deck's recording settings (streamsPerAccount: 1 to 4). */
function setSettings({ streamsPerAccount } = {}) {
    const s = load();
    if (streamsPerAccount != null) {
        const n = Number(streamsPerAccount);
        if (!Number.isInteger(n) || n < 1 || n > MAX_STREAMS) throw Object.assign(new Error(`Streams per account is 1 to ${MAX_STREAMS}.`), { code: 'XMRADIO_SETTING' });
        s.settings.streamsPerAccount = n;
    }
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
    let lastSeq = null;
    for (const s of segs) {
        if (lastSeq != null && s.seq !== lastSeq + 1) out.push('#EXT-X-DISCONTINUITY');
        out.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(s.pdt).toISOString()}`, `#EXTINF:${s.dur.toFixed(3)},`, s.f);
        lastSeq = s.seq;
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
        const entry = makeEntry('timer', t.channelId, { from: Math.min(at, now), to, ref: t.id, mode: t.mode, fromNow: true });
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

/** Which alert or term the cut matches: an alert for its artist (or artist and title), else a term whose every word
 *  is in the artist, title or show. `id` is the channel's. */
function matchOnAir(id, cur, alerts, terms) {
    for (const a of alerts) {
        if (a.channelId && a.channelId !== id) continue;
        if (norm(a.artist) !== norm(cur.a)) continue;
        if (a.kind === 'song' && norm(a.title) !== norm(cur.t)) continue;
        return { kind: 'alert', ref: a.id };
    }
    const hay = norm(`${cur.a} ${cur.t} ${cur.s}`);
    for (const t of terms) {
        if (t.channelId && t.channelId !== id) continue;
        const words = norm(t.text).split(' ').filter(Boolean);
        if (words.length && words.every((w) => hay.includes(w))) return { kind: 'term', ref: t.id };
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
        const hit = matchOnAir(id, cur, s.alerts, s.terms);
        if (!hit) continue;
        fired.add(key);
        if (fired.size > 2000) fired.delete(fired.values().next().value);
        // an alert or term records the matching cut from its first frame: it queues, and reaches back when a slot takes it
        submit(makeEntry(hit.kind, id, { from: cur.at, fromCut: cur.at, until: now + 2 * 3600 * 1000, ref: hit.ref, a: cur.a, t: cur.t, s: cur.s, ik: cur.ik }))
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
        settings: { streamsPerAccount: s.settings.streamsPerAccount }, pool: poolView()
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
        off: !!t.off
    }));
    armTimers();
    changed();
    return s.timers;
}

function addAlert({ kind, artist, title, channelId } = {}) {
    const s = load();
    const a = { id: id8(), kind: kind === 'song' ? 'song' : 'artist', artist: String(artist || '').slice(0, 200), title: kind === 'song' ? String(title || '').slice(0, 200) : '', channelId: channelId ? String(channelId) : null };
    if (!a.artist) throw new Error('Nothing is playing to set an alert for.');
    if (s.alerts.some((x) => x.kind === a.kind && norm(x.artist) === norm(a.artist) && norm(x.title) === norm(a.title))) return s.alerts;
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
    s.terms = (Array.isArray(list) ? list : []).slice(0, 50).map((t) => ({
        id: t && /^[0-9a-f]{12}$/.test(t.id) ? t.id : id8(),
        text: String((t && t.text) || '').trim().slice(0, 120),
        channelId: t && t.channelId ? String(t.channelId) : null
    })).filter((t) => norm(t.text));
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
    clearTimeout(expiryHandle);
    expiryHandle = null;
    // the cut store is on disk with the state file
    if (cutStore.isOpen()) await Promise.race([cutStore.flush().catch(() => {}), delay(3000)]);
    saveNow();
    return { recordings: live.length, queue: (load().queue || []).length, running: (load().running || []).length };
}

/** A resumed recording's entry (one from before the common queue has none): linked by rid, running. */
function adoptEntry(meta) {
    const s = load();
    let e = s.running.find((x) => x.id === meta.entryId || x.rid === meta.rid);
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

/** Recordings left by a stopped server: file what they hold, and carry on those whose time is not up. */
async function resume() {
    const s = load();
    const left = s.active || [];
    s.active = [];
    for (const meta of left) {
        if (recs.has(meta.rid)) continue;
        const dir = path.join(recRoot(), meta.rid);
        const rec = { meta, dir, segs: [], cuts: [], lastEnd: 0, write: Promise.resolve(), pump: null, filing: false };
        try {
            const segs = (await fs.promises.readFile(path.join(dir, 'segs.ndjson'), 'utf8')).split('\n').filter(Boolean).map((l) => Object.assign(JSON.parse(l), { ok: true }));
            rec.segs = segs;
            rec.lastEnd = segs.length ? segs[segs.length - 1].pdt + segs[segs.length - 1].dur * 1000 : 0;
        } catch (_) { /* nothing recorded */ }
        try { rec.cuts = (await fs.promises.readFile(path.join(dir, 'cuts.ndjson'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.at - b.at); } catch (_) { /* none */ }
        recs.set(meta.rid, rec);
        adoptEntry(meta);
        // it carries on as the same recording (Yukimi, Nov 21 2026: a recording must never stop because a server did):
        // a graceful handoff stored the exact next segment, a hard stop falls back to the last one on disk. The pump
        // reads from there, the stream keeps five hours, so the time the process was down is recorded too.
        const stored = !!meta.resumeAt;
        const anchor = meta.resumeAt || rec.lastEnd;
        const gap = anchor ? Math.ceil((Date.now() - anchor) / 1000) + 2 : Math.ceil((Date.now() - meta.startPdt) / 1000);
        const due = (meta.until && Date.now() >= meta.until - 5000) || (rec.lastEnd && rec.lastEnd - meta.startPdt >= MAX_MS);
        if (due || gap > 5 * 3600 - 300 || !xm.channelById(meta.channelId)) { await stop(meta.rid); continue; }
        rec.pump = makePump(rec, Math.max(0, gap));
        if (gap > 0) metaBackfill(rec, Date.now() - gap * 1000);
        delete meta.resumeAt; delete meta.resumeSeq;
        console.log(`[xmRadio rec] ${meta.rid}: resumed (${meta.kind}, ${gap} s to catch up${stored ? ', at the stored segment' : ''})`);
    }
    if (recs.size) { xm.watch('rec', true); armMetaTimer(); }
    // a started entry whose recording is not back has ended with the process
    for (const e of s.running.slice()) if (!recs.has(e.rid)) retire(e, 'done', 'Ended while the recorder was down');
    changed();
    // the queue lives in the state file: pick it up again after a recorder restart (the resumed recordings hold their
    // slots; what waits starts as they free, and entries that ran out of buffer meanwhile are missed)
    void dispatch();
    // folders no recording owns (a crash before its state was written)
    try {
        for (const d of await fs.promises.readdir(recRoot())) {
            if (!recs.has(d) && !ended.has(d)) fs.promises.rm(path.join(recRoot(), d), { recursive: true, force: true }).catch(() => {});
        }
    } catch (_) { /* no folder yet */ }
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
    init, library, tapeRenamed, saveNow, shutdown, importSpool, spoolList, spoolDir: () => spoolDir(), recRoot: () => recRoot(), start, stop, recordCut, recordChannel, recordRange, queueList: queuePublic, queueRemove, queueClear, cancel, setSettings, slotsChanged, dispatch, tapesInfo, trackPath, trackRename, trackDelete, trackMove, tapeNew, tapeRename, tapeDelete, deck, setDeck, setTimers, addAlert, removeAlert, setTerms, tapes, tracks, playlist, segPath,
    _test: { adtsFrames, nextStart, cutAt, norm, onLook, onAirCut, matchOnAir, sliceAac, recs, resume, fireTimers, makeEntry, freeSlots, load: () => load(), reset: () => { st = null; clearTimeout(expiryHandle); expiryHandle = null; reserved.clear(); stopMetaTimer(); cutStore._test.reset(''); recs.clear(); ended.clear(); fired.clear(); shuttingDown = false; } }
};
