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

const MAX_MS = 8 * 3600 * 1000;
const MAX_AUTO = 4; // recordings at once (the deck's own and the automatic ones)
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
    return st;
}

/** Written off the event loop, at most once a second. */
function save() {
    if (saveTimer) return;
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
    save();
    try { onChange(); } catch (_) { /* the feed is optional */ }
}

const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const safeName = (t, max = 120) => String(t || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max);
const id8 = () => crypto.randomBytes(6).toString('hex');

// ------------------------------------------------------------------ AAC frames

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

/** A tape's recordings in order: [{ id, name, size, at }]. */
async function tracks(workspaceId, name) {
    const f = await tapeFolder(workspaceId, name, false);
    if (!f) return [];
    const db = require('./vfsDatabase');
    const files = await db.getUserFilesByLocation('workspace', workspaceId, f.id);
    return (files || []).filter((x) => !x.trashed_at && /\.(m4a|aac|mp3)$/i.test(x.original_name || ''))
        .map((x) => ({ id: x.id, name: x.original_name, size: x.size, at: x.created_at }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
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
    const folder = await tapeFolder(rec.meta.workspaceId, rec.meta.tape, true);
    const v = await vfs();
    const db = require('./vfsDatabase');
    const used = new Set(((await db.getUserFilesByLocation('workspace', rec.meta.workspaceId, folder.id)) || []).map((x) => String(x.original_name || '').toLowerCase()));
    let n = `${name}.m4a`;
    for (let i = 2; used.has(n.toLowerCase()); i += 1) n = `${name} (${i}).m4a`;
    await v.saveUserFileFromPath(tmpPath, { originalName: n, mimeType: 'audio/mp4', scope: 'workspace', workspaceId: rec.meta.workspaceId, folderId: folder.id });
    const ws = gr.getWebSocketServer && gr.getWebSocketServer();
    if (ws && ws.broadcast) ws.broadcast({ type: 'vfs_updated', data: { path: `/Workspaces/${rec.meta.workspaceId}/${folder.id}` }, timestamp: new Date().toISOString() });
    rec.meta.filed = (rec.meta.filed || 0) + 1;
    return n;
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
        '-metadata', `album=${ch.number ? `${ch.number} ` : ''}${ch.name}`, '-metadata', `date=${when.toISOString().slice(0, 10)}`,
        '-metadata', `comment=Recorded from SiriusXM ${ch.name} on ${when.toISOString()}${cut && cut.s ? `; show: ${cut.s}` : ''}`,
        '-metadata', `track=${(rec.meta.filed || 0) + 1}`,
        '-movflags', '+faststart', out);
    try {
        await ffmpeg(args);
        const stamp = `${pad2(when.getHours())}${pad2(when.getMinutes())}`;
        const name = safeName(`${when.toISOString().slice(0, 10)} ${stamp} ${artist === ch.name ? title : `${artist} - ${title}`}`);
        await fileInto(rec, out, name);
    } catch (err) {
        console.warn(`[xmRadio rec] ${rec.meta.rid}: a cut was not filed: ${err.message}`);
    } finally {
        fs.promises.rm(tmp, { force: true }).catch(() => {});
        fs.promises.rm(out, { force: true }).catch(() => {});
    }
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
    const lines = [';FFMETADATA1', `title=${ffMetaEsc(`${ch.name}, ${when.toLocaleString('en-US')}`)}`, `artist=${ffMetaEsc(ch.name)}`, `album=${ffMetaEsc(ch.name)}`, `date=${when.toISOString().slice(0, 10)}`];
    const cuts = rec.cuts.filter((c) => c.at < to);
    cuts.forEach((c, i) => {
        const s = Math.max(0, c.at - from);
        const e = Math.min(to, (cuts[i + 1] ? cuts[i + 1].at : to)) - from;
        if (e <= s) return;
        lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(s)}`, `END=${Math.round(e)}`, `title=${ffMetaEsc(c.ad ? (c.s || 'Break') : [c.a, c.t].filter(Boolean).join(' - ') || c.s || ch.name)}`);
    });
    await fs.promises.writeFile(meta, `${lines.join('\n')}\n`);
    try {
        await ffmpeg(['-f', 'aac', '-i', tmp, '-i', meta, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', out]);
        await fileInto(rec, out, safeName(`${when.toISOString().slice(0, 10)} ${pad2(when.getHours())}${pad2(when.getMinutes())} ${ch.name}`));
    } catch (err) {
        console.warn(`[xmRadio rec] ${rec.meta.rid}: not filed: ${err.message}`);
    } finally {
        for (const p of [tmp, out, meta]) fs.promises.rm(p, { force: true }).catch(() => {});
    }
}

/** The cut in force at a moment, and when it ends (the next cut's start, or null). */
function cutAt(rec, t) {
    let cur = null;
    let next = null;
    for (const c of rec.cuts) {
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
        const recEnd = rec.lastEnd;
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
    const f = `s${sg.seq}.aac`;
    const row = { seq: sg.seq, pdt: sg.pdt, dur: sg.dur, f };
    rec.segs.push(row);
    rec.lastEnd = sg.pdt + sg.dur * 1000;
    rec.write = rec.write.then(async () => {
        await fs.promises.writeFile(path.join(rec.dir, f), sg.plain);
        await fs.promises.appendFile(path.join(rec.dir, 'segs.ndjson'), `${JSON.stringify(row)}\n`);
    }).catch((err) => console.warn(`[xmRadio rec] ${rec.meta.rid}: ${err.message}`));
    if (rec.lastEnd - rec.meta.startPdt >= MAX_MS || (rec.meta.until && Date.now() >= rec.meta.until)) { void stop(rec.meta.rid); return; }
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
        channelId: rec.meta.channelId, quality: 'hi', keyBytes: xm.keyBytes,
        tune: async (id) => xm.tuneUpstream(id),
        log: (lvl, t) => console.warn(t)
    });
    pump.on('segment', (sg) => appendSeg(rec, sg));
    pump.on('error', (err) => { rec.meta.error = err.message; void stop(rec.meta.rid); });
    pump.start({ back });
    return pump;
}

/**
 * Start recording a channel: kind manual (the deck's REC), timer, alert or term. `back` seconds behind live (an alert
 * reaches back to the start of the matched cut); `until` the wall-clock end (at most 8 hours).
 */
/**
 * One-touch Record (the phone's Today item, Yukimi Nov 20 2026): the cut on air now, from its first frame when asked
 * ("Record from the start?" Yes), else from now; it stops when the cut ends.
 */
async function recordCut(channelId, { fromStart } = {}) {
    const cut = xm.nowPlayingCuts(String(channelId || '')).slice(-1)[0];
    const now = Date.now();
    if (fromStart && cut && now - cut.at < 4 * 3600 * 1000) {
        return start({ channelId, kind: 'song', back: Math.ceil((now - cut.at) / 1000) + 8, fromCut: cut.at, until: now + 2 * 3600 * 1000 });
    }
    return start({ channelId, kind: 'song', back: 0, fromCut: now, until: now + 2 * 3600 * 1000 });
}

async function start(opts) {
    const s = load();
    const channelId = String(opts.channelId || '');
    if (!xm.channelById(channelId)) throw Object.assign(new Error('No such channel.'), { code: 'XMRADIO_CHANNEL' });
    for (const r of recs.values()) if (r.meta.channelId === channelId) return describe(r);
    if (recs.size >= MAX_AUTO) throw Object.assign(new Error('The deck is already making four recordings.'), { code: 'XMRADIO_REC_BUSY' });
    const rid = id8() + id8();
    const dir = path.join(recRoot(), rid);
    await fs.promises.mkdir(dir, { recursive: true });
    const now = Date.now();
    const back = Math.max(0, Math.min(5 * 3600, Number(opts.back) || 0));
    const meta = {
        rid, channelId, kind: opts.kind || 'manual', ref: opts.ref || null,
        workspaceId: opts.workspaceId || s.deck.workspaceId, tape: opts.tape || s.deck.tape,
        mode: opts.kind === 'alert' || opts.kind === 'term' || opts.kind === 'song' ? 'song' : (opts.mode || s.deck.mode),
        since: now, until: Math.min(now + MAX_MS, Number(opts.until) || now + MAX_MS), startPdt: now - back * 1000, cursor: 0, filed: 0
    };
    const rec = { meta, dir, segs: [], cuts: [], lastEnd: 0, write: Promise.resolve(), pump: null, filing: false };
    const np = xm.nowPlayingCuts(channelId);
    if (np.length) {
        rec.cuts.push(...np);
        fs.promises.appendFile(path.join(dir, 'cuts.ndjson'), np.map((c) => `${JSON.stringify(c)}\n`).join('')).catch(() => {});
    }
    recs.set(rid, rec);
    rec.pump = makePump(rec, back);
    // song mode starts at the cut in force (an alert's cut from its first frame)
    if (meta.mode === 'song' && opts.fromCut) meta.cursor = opts.fromCut;
    xm.watch('rec', true);
    changed();
    return describe(rec);
}

async function stop(rid, { filed } = {}) {
    const rec = recs.get(rid);
    if (!rec || rec.stopping) return null;
    rec.stopping = true;
    try { rec.pump && rec.pump.stop(); } catch (_) { /* stopped */ }
    await rec.write;
    try {
        if (rec.meta.mode === 'long') await fileLong(rec);
        else if (!filed) {
            await fileFinishedCuts(rec);
            const from = rec.meta.cursor || (rec.segs[0] && rec.segs[0].pdt);
            if (from && rec.lastEnd > from) { const { cur } = cutAt(rec, from + 1); await fileCut(rec, cur, from, rec.lastEnd, true); }
        }
    } catch (err) { console.warn(`[xmRadio rec] ${rid}: ${err.message}`); }
    recs.delete(rid);
    // the playlist answers a little longer (a radio playing it reaches its end), then the segments go
    rec.ended = Date.now();
    ended.set(rid, rec);
    setTimeout(() => { ended.delete(rid); fs.promises.rm(rec.dir, { recursive: true, force: true }).catch(() => {}); }, 10 * 60 * 1000).unref?.();
    if (!recs.size) xm.watch('rec', false);
    changed();
    return { rid, filed: rec.meta.filed || 0 };
}
const ended = new Map();

function describe(rec) {
    const m = rec.meta;
    const { cur } = cutAt(rec, rec.lastEnd || Date.now());
    return {
        rid: m.rid, channelId: m.channelId, kind: m.kind, mode: m.mode, tape: m.tape, since: m.since, until: m.until,
        filed: m.filed || 0, url: `/api/xmradio/rec/${m.rid}/index.m3u8`,
        cut: cur ? { a: cur.a, t: cur.t, s: cur.s, ad: !!cur.ad } : null
    };
}

/** The recording as a growing HLS playlist (EVENT): everything recorded so far stays playable. */
function playlist(rid) {
    const rec = recs.get(rid) || ended.get(rid);
    if (!rec) return null;
    const segs = rec.segs;
    const td = Math.ceil(Math.max(10, ...segs.map((s) => s.dur)));
    const out = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${td}`, `#EXT-X-MEDIA-SEQUENCE:${segs.length ? segs[0].seq : 0}`, '#EXT-X-PLAYLIST-TYPE:EVENT'];
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
        const now = Date.now();
        for (const t of load().timers) {
            if (t.off) continue;
            const at = nextStart(t, now - 60000);
            if (at == null || at > now + 1000 || t.lastRun === at) continue;
            t.lastRun = at;
            if (t.date) t.off = true;
            const until = at + Math.max(1, Math.min(480, Number(t.minutes) || 60)) * 60000;
            start({ channelId: t.channelId, kind: 'timer', ref: t.id, until, mode: t.mode }).catch((err) => console.warn(`[xmRadio rec] timer ${t.id}: ${err.message}`));
        }
        changed();
        armTimers();
    }, wait);
    if (timerHandle.unref) timerHandle.unref();
}

function wantsWatch() {
    const s = load();
    return s.alerts.length > 0 || s.terms.length > 0;
}

/** Every channel's cuts after a lookAround read: the recordings' splits, alerts and terms. */
function onLook(channelCuts) {
    for (const rec of recs.values()) {
        const cuts = channelCuts.get(rec.meta.channelId);
        if (cuts) noteCuts(rec, cuts);
    }
    const s = load();
    if (!s.alerts.length && !s.terms.length) return;
    const now = Date.now();
    for (const [id, cuts] of channelCuts) {
        const cur = cuts[cuts.length - 1];
        if (!cur || cur.ad || now - cur.at > 15 * 60000) continue;
        const key = `${id}|${cur.at}`;
        if (fired.has(key)) continue;
        const ch = xm.channelById(id);
        if (!ch || ch.sub === false) continue;
        let hit = null;
        for (const a of s.alerts) {
            if (a.channelId && a.channelId !== id) continue;
            if (norm(a.artist) !== norm(cur.a)) continue;
            if (a.kind === 'song' && norm(a.title) !== norm(cur.t)) continue;
            hit = { kind: 'alert', ref: a.id };
            break;
        }
        if (!hit) {
            const hay = norm(`${cur.a} ${cur.t} ${cur.s}`);
            for (const t of s.terms) {
                if (t.channelId && t.channelId !== id) continue;
                const words = norm(t.text).split(' ').filter(Boolean);
                if (words.length && words.every((w) => hay.includes(w))) { hit = { kind: 'term', ref: t.id }; break; }
            }
        }
        if (!hit) continue;
        fired.add(key);
        if (fired.size > 2000) fired.delete(fired.values().next().value);
        start({ channelId: id, kind: hit.kind, ref: hit.ref, back: Math.ceil((now - cur.at) / 1000) + 8, fromCut: cur.at, until: now + 2 * 3600 * 1000 })
            .catch((err) => console.warn(`[xmRadio rec] ${hit.kind} ${hit.ref}: ${err.message}`));
    }
}

// ------------------------------------------------------------------ the deck's settings

function deck() {
    const s = load();
    return {
        tape: s.deck.tape, workspaceId: s.deck.workspaceId, mode: s.deck.mode,
        recordings: [...recs.values()].map(describe),
        timers: s.timers, alerts: s.alerts, terms: s.terms
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

/** Recordings left by a stopped server: file what they hold, and carry on those whose time is not up. */
async function resume() {
    const s = load();
    const left = s.active || [];
    s.active = [];
    for (const meta of left) {
        const dir = path.join(recRoot(), meta.rid);
        const rec = { meta, dir, segs: [], cuts: [], lastEnd: 0, write: Promise.resolve(), pump: null, filing: false };
        try {
            const segs = (await fs.promises.readFile(path.join(dir, 'segs.ndjson'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
            rec.segs = segs;
            rec.lastEnd = segs.length ? segs[segs.length - 1].pdt + segs[segs.length - 1].dur * 1000 : 0;
        } catch (_) { /* nothing recorded */ }
        try { rec.cuts = (await fs.promises.readFile(path.join(dir, 'cuts.ndjson'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.at - b.at); } catch (_) { /* none */ }
        recs.set(meta.rid, rec);
        await stop(meta.rid);
        if (Date.now() < meta.until - 60000 && (meta.kind === 'manual' || meta.kind === 'timer')) {
            start({ channelId: meta.channelId, kind: meta.kind, ref: meta.ref, until: meta.until, mode: meta.mode, tape: meta.tape, workspaceId: meta.workspaceId })
                .catch((err) => console.warn(`[xmRadio rec] resume ${meta.rid}: ${err.message}`));
        }
    }
    // folders no recording owns (a crash before its state was written)
    try {
        for (const d of await fs.promises.readdir(recRoot())) {
            if (!recs.has(d) && !ended.has(d)) fs.promises.rm(path.join(recRoot(), d), { recursive: true, force: true }).catch(() => {});
        }
    } catch (_) { /* no folder yet */ }
}

let booted = false;
function init(xmRadio, globalResources, { changed: cb } = {}) {
    xm = xmRadio;
    gr = globalResources;
    if (cb) onChange = cb;
    if (booted) return module.exports;
    booted = true;
    load();
    armTimers();
    xm.watch('match', wantsWatch());
    xm.onLook(onLook);
    setTimeout(() => { resume().catch((err) => console.warn(`[xmRadio rec] resume: ${err.message}`)); }, 15000).unref?.();
    return module.exports;
}

module.exports = {
    init, start, stop, recordCut, trackPath, trackRename, trackDelete, trackMove, tapeNew, tapeRename, tapeDelete, deck, setDeck, setTimers, addAlert, removeAlert, setTerms, tapes, tracks, playlist, segPath,
    _test: { adtsFrames, nextStart, cutAt, norm, onLook, sliceAac, recs, load: () => load(), reset: () => { st = null; recs.clear(); ended.clear(); fired.clear(); } }
};
