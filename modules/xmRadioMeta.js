'use strict';

/**
 * XM Radio's durable cut metadata (Yozora #1252 section 1: the rule ported from the old Lizumi engine,
 * lizumi-sxm-server server.js:699-732).
 *
 * One list of cuts per channel, kept across restarts and MERGED into, never assigned: SiriusXM's lookAround and
 * liveUpdate windows slide and only reach back a little, while the audio stays recordable from a five hour buffer, so
 * a cut's name has to outlive the poll that no longer mentions it.
 *
 * Record: { at (ms, the identity with isEpisode), end (ms, 0 unknown), dur (s, 0 unknown), guid, title, artist, album
 * (the show's name for a cut on air in a show), ad, ik (art key), isSong (dur <= 900 s), isEpisode, mod (edited by
 * a person: its text is never rewritten), updateCount (placeholder repair attempts) }.
 *
 * The merge:
 *  - an incoming item whose `at` is stored updates that record in place, otherwise it is appended; the list is never
 *    cut down to the poll's window and is kept sorted by `at`;
 *  - dur, guid and end are always refreshed from the fresh read (a value that is unknown there never wipes a known one);
 *  - title, artist and album are rewritten only while the stored text is still a placeholder (empty, a word of the
 *    ignored list, the channel's own name, or the cut was an ad) AND the record is not edited AND fewer than 10
 *    repairs were tried; a real value is never replaced by a placeholder;
 *  - a cut whose known length is under 65 s is not kept (it may sit here provisionally while its length is unknown);
 *  - songs are kept one day, everything else a week; a missing length is back-filled when READ from the next record's
 *    start and is never stored.
 *
 * File: <cache>/xmradio-meta.json (mode 0600, written atomically off the event loop at most every few seconds). Only the
 * recorder service (role capture) writes it; Dreamscape reads through the service's socket (ops meta, metaStats).
 */

const fs = require('fs');
const path = require('path');

const SONG_MAX_S = 900;
const MIN_CUT_S = 65;
const SONG_KEEP_MS = 24 * 3600 * 1000;
const OTHER_KEEP_MS = 7 * 24 * 3600 * 1000;
const MAX_REPAIRS = 10;
const WRITE_EVERY_MS = 5000;
const DEFAULT_IGNORED = ['SiriusXM', 'Commercial', 'Commercial Free', 'Ad', 'Break', 'Coming Up', '@siriusxm'];

let filePath = '';
let data = null; // { settings: { ignoredWords: [extra] }, channels: { id: { name, cuts: [] } } }
let dirty = false;
let writeTimer = null;
let writing = null;
const shortAt = new Map(); // channelId -> Set of `at` dropped for being under 65 s (memory only: lookAround must not bring them back)

const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();

/** Use this file (loading it); the same file again is a no-op. */
function open(file) {
    file = process.env.XMRADIO_META_FILE || file; // a test (or an operator) can point it elsewhere
    if (file && file === filePath && data) return module.exports;
    if (data && dirty && filePath) { try { writeSync(); } catch (_) { /* best effort */ } }
    clearTimeout(writeTimer);
    writeTimer = null;
    filePath = String(file || '');
    data = null;
    dirty = false;
    return load();
}

function load() {
    if (data) return module.exports;
    let j = null;
    try { j = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { j = null; }
    data = { settings: { ignoredWords: [] }, channels: {} };
    if (j && typeof j === 'object') {
        if (j.settings && Array.isArray(j.settings.ignoredWords)) data.settings.ignoredWords = j.settings.ignoredWords.map(String).filter(Boolean).slice(0, 200);
        for (const [id, c] of Object.entries(j.channels || {})) {
            if (!c || !Array.isArray(c.cuts)) continue;
            data.channels[id] = { name: String(c.name || ''), cuts: c.cuts.filter((x) => x && Number(x.at) > 0).map(clean).sort(bySort) };
        }
    }
    prune(Date.now());
    return module.exports;
}

const ensure = () => { if (!data) load(); return data; };
const bySort = (a, b) => a.at - b.at || (a.isEpisode ? 1 : 0) - (b.isEpisode ? 1 : 0);

function clean(x) {
    const dur = Math.max(0, Math.round(Number(x.dur) || 0));
    const isEpisode = !!x.isEpisode;
    return {
        at: Math.round(Number(x.at)),
        end: Math.max(0, Math.round(Number(x.end) || 0)),
        dur,
        guid: String(x.guid || ''),
        title: String(x.title || ''),
        artist: isEpisode ? '' : String(x.artist || ''),
        album: isEpisode ? '' : String(x.album || ''),
        ad: !!x.ad,
        ik: String(x.ik || ''),
        isSong: isEpisode ? false : (dur ? dur <= SONG_MAX_S : true),
        isEpisode,
        mod: !!x.mod,
        updateCount: Math.max(0, Math.round(Number(x.updateCount) || 0))
    };
}

/** The words that mean "no real name yet" for this channel. */
function ignoredSet(channelName) {
    const s = new Set(DEFAULT_IGNORED.map(lower));
    for (const w of ensure().settings.ignoredWords) s.add(lower(w));
    if (channelName) s.add(lower(channelName));
    return s;
}
const isPlaceholder = (text, ignored) => { const t = lower(text); return !t || ignored.has(t); };

function channelOf(id, create) {
    const d = ensure();
    let c = d.channels[id];
    if (!c && create) c = d.channels[id] = { name: '', cuts: [] };
    return c || null;
}

function touch() {
    dirty = true;
    if (writeTimer || !filePath) return;
    writeTimer = setTimeout(() => { writeTimer = null; void writeFile(); }, WRITE_EVERY_MS);
    if (writeTimer.unref) writeTimer.unref();
}

function snapshot() {
    return JSON.stringify({ v: 1, settings: data.settings, channels: data.channels });
}

/** Off the event loop: tmp file and rename, mode 0600. One write at a time; a change during one schedules the next. */
async function writeFile() {
    if (!data || !filePath) return;
    if (writing) { await writing; if (dirty) return writeFile(); return; }
    prune(Date.now()); // the retention rides on the writes: no timer of its own
    dirty = false;
    const f = filePath;
    const body = snapshot();
    const tmp = `${f}.${process.pid}.tmp`;
    writing = fs.promises.mkdir(path.dirname(f), { recursive: true })
        .then(() => fs.promises.writeFile(tmp, body, { mode: 0o600 }))
        .then(() => fs.promises.rename(tmp, f))
        .catch((err) => { dirty = true; console.warn(`[xmRadio meta] not saved: ${err.message}`); })
        .finally(() => { writing = null; });
    await writing;
}

function writeSync() {
    prune(Date.now());
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(`${filePath}.${process.pid}.tmp`, snapshot(), { mode: 0o600 });
    fs.renameSync(`${filePath}.${process.pid}.tmp`, filePath);
    dirty = false;
}

/** The file now (shutdown): resolves once what changed is on disk. */
async function flush() {
    clearTimeout(writeTimer);
    writeTimer = null;
    if (!data || !filePath) return;
    if (writing) await writing;
    if (dirty) await writeFile();
}

function tombstone(id, at) {
    let s = shortAt.get(id);
    if (!s) shortAt.set(id, s = new Set());
    s.add(at);
    if (s.size > 500) s.delete(s.values().next().value);
}

function expired(c, now) {
    if (!c.isEpisode && c.dur && c.dur < MIN_CUT_S) return true;
    return now - c.at > (c.isSong && !c.isEpisode ? SONG_KEEP_MS : OTHER_KEEP_MS);
}

/** Drop what retention says; -> how many records went. */
function prune(now = Date.now()) {
    const d = ensure();
    let n = 0;
    for (const [id, c] of Object.entries(d.channels)) {
        const keep = c.cuts.filter((x) => {
            if (!expired(x, now)) return true;
            if (!x.isEpisode && x.dur && x.dur < MIN_CUT_S) tombstone(id, x.at);
            return false;
        });
        n += c.cuts.length - keep.length;
        if (keep.length !== c.cuts.length) c.cuts = keep;
        if (!keep.length) delete d.channels[id];
    }
    if (n) touch();
    return n;
}

/**
 * Merge a read into a channel. items: [{ at, a, t, s (the show), ad, ik, dur (s), guid, end, ep (an episode: its name
 * is t, its show s) }]; the lookAround cuts and the liveUpdate items both fit. -> { added, updated, repaired }
 */
function merge(channelId, items, opts = {}) {
    const out = { added: 0, updated: 0, repaired: 0 };
    const id = String(channelId || '');
    if (!id || !Array.isArray(items) || !items.length) return out;
    const chName = String(opts.channelName || '');
    let c = channelOf(id, false);
    const ignored = ignoredSet(chName || (c && c.name));
    let changed = false;
    for (const x of items) {
        const at = Math.round(Number(x && x.at));
        if (!(at > 0)) continue;
        if (!c) c = channelOf(id, true);
        if (chName && c.name !== chName) { c.name = chName; changed = true; }
        const ep = !!x.ep;
        const inc = {
            title: String(x.t || ''), artist: ep ? '' : String(x.a || ''), album: ep ? '' : String(x.s || ''),
            ad: !!x.ad, ik: String(x.ik || ''), dur: Math.max(0, Math.round(Number(x.dur) || 0)),
            guid: String(x.guid || ''), end: Math.max(0, Math.round(Number(x.end) || 0))
        };
        if (inc.dur && !inc.end) inc.end = at + inc.dur * 1000;
        const i = c.cuts.findIndex((r) => r.at === at && r.isEpisode === ep);
        if (i < 0) {
            // a cut known to be short is not kept
            if (!ep && inc.dur && inc.dur < MIN_CUT_S) { tombstone(id, at); continue; }
            if (!ep && shortAt.has(id) && shortAt.get(id).has(at)) continue;
            c.cuts.push(clean({ at, end: inc.end, dur: inc.dur, guid: inc.guid, title: inc.title, artist: inc.artist, album: inc.album, ad: inc.ad, ik: inc.ik, isEpisode: ep }));
            out.added++;
            changed = true;
            continue;
        }
        const r = c.cuts[i];
        let did = false;
        // the refining fields: always from the fresh read
        if (inc.dur && inc.dur !== r.dur) { r.dur = inc.dur; r.end = inc.end; r.isSong = !ep && inc.dur <= SONG_MAX_S; did = true; }
        else if (inc.end && inc.end !== r.end) { r.end = inc.end; did = true; }
        if (inc.guid && inc.guid !== r.guid) { r.guid = inc.guid; did = true; }
        if (inc.ik && !r.ik) { r.ik = inc.ik; did = true; }
        // the words: only while still placeholder, not edited, and within the repair budget
        const placeholder = r.ad || isPlaceholder(r.title, ignored) || (!ep && isPlaceholder(r.artist, ignored));
        // an attempt is a different answer: lookAround repeats the same words every 20 s, and counting those used the
        // ten repairs up minutes before liveUpdate brought the real name
        // (compared with the last answer seen, kept as `la`, since a placeholder answer never lands in the record's text)
        const ans = `${inc.ad ? 1 : 0}|${inc.title}|${ep ? '' : inc.artist}|${ep ? '' : inc.album}`;
        const differs = ans !== (r.la == null ? `${r.ad ? 1 : 0}|${r.title}|${r.artist}|${r.album}` : r.la);
        if (differs) { r.la = ans; did = true; }
        if (placeholder && differs && !r.mod && r.updateCount < MAX_REPAIRS) {
            r.updateCount++;
            did = true;
            const incAd = inc.ad;
            const real = (v) => !incAd && !isPlaceholder(v, ignored);
            let fixed = false;
            if (real(inc.title) && (r.ad || isPlaceholder(r.title, ignored))) { r.title = inc.title; fixed = true; }
            if (!ep && real(inc.artist) && (r.ad || isPlaceholder(r.artist, ignored))) { r.artist = inc.artist; fixed = true; }
            if (!ep && real(inc.album) && (r.ad || isPlaceholder(r.album, ignored))) { r.album = inc.album; fixed = true; }
            if (fixed) {
                if (r.ad && !incAd) r.ad = false;
                out.repaired++;
            }
        }
        if (!ep && r.dur && r.dur < MIN_CUT_S) { c.cuts.splice(i, 1); tombstone(id, at); did = true; }
        if (did) { out.updated++; changed = true; }
    }
    if (c) c.cuts.sort(bySort);
    if (changed) touch();
    return out;
}

/** A liveUpdateRange answer ({ items, episodes }) as merge items. */
function mergeRange(channelId, range, opts) {
    const items = [];
    for (const x of (range && range.items) || []) items.push({ at: x.at, dur: x.dur, a: x.a, t: x.t, ad: x.ad, ik: x.ik, guid: x.guid });
    for (const x of (range && range.episodes) || []) items.push({ at: x.at, dur: x.dur, t: x.name, s: x.show, ik: x.ik, guid: x.guid, ep: true });
    return merge(channelId, items, opts);
}

/** A copy of the list with the missing lengths worked out from the next record's start (a guess is never stored). */
function filled(cuts) {
    const out = cuts.map((r) => Object.assign({}, r));
    for (let i = 0; i < out.length; i++) {
        const r = out[i];
        if (r.dur) continue;
        let next = null;
        for (let j = i + 1; j < out.length; j++) if (out[j].isEpisode === r.isEpisode && out[j].at > r.at) { next = out[j]; break; }
        if (!next) continue;
        r.dur = Math.round((next.at - r.at) / 1000);
        r.end = next.at;
        r.derived = true;
        if (!r.isEpisode) r.isSong = r.dur <= SONG_MAX_S;
    }
    return out;
}

/** The records that overlap [from, to), with their lengths filled in. { episodes: false } leaves the shows out. */
function cutsBetween(channelId, from, to, opts = {}) {
    const c = channelOf(String(channelId || ''), false);
    if (!c) return [];
    const lo = Number(from) || 0;
    const hi = Number.isFinite(Number(to)) && Number(to) > 0 ? Number(to) : Infinity;
    return filled(c.cuts).filter((r) => {
        if (opts.episodes === false && r.isEpisode) return false;
        // no end known (on air now): open ended
        return r.at < hi && (r.end ? r.end > lo : true);
    });
}

/** The cut in force at t: the last cut that began at or before it. */
function cutAt(channelId, t) {
    const c = channelOf(String(channelId || ''), false);
    if (!c) return null;
    const list = filled(c.cuts).filter((r) => !r.isEpisode && r.at <= t);
    return list.length ? list[list.length - 1] : null;
}

/** A person's edit (the console): the record's text is theirs from now on. -> the record, or null when there is none. */
function edit(channelId, at, fields = {}) {
    const c = channelOf(String(channelId || ''), false);
    const t = Math.round(Number(at));
    const r = c && (c.cuts.find((x) => x.at === t && !x.isEpisode) || c.cuts.find((x) => x.at === t));
    if (!r) return null;
    for (const k of ['title', 'artist', 'album']) if (typeof fields[k] === 'string') r[k] = fields[k];
    if (r.isEpisode) r.artist = r.album = '';
    if (typeof fields.title === 'string' && fields.title.trim()) r.ad = false;
    r.mod = true;
    touch();
    return Object.assign({}, r);
}

function stats() {
    const d = ensure();
    let cuts = 0;
    let oldest = 0;
    let newest = 0;
    for (const c of Object.values(d.channels)) {
        cuts += c.cuts.length;
        for (const r of c.cuts) {
            if (!oldest || r.at < oldest) oldest = r.at;
            if (r.at > newest) newest = r.at;
        }
    }
    return { channels: Object.keys(d.channels).length, cuts, oldest, newest, file: filePath };
}

const settings = {
    get: () => ({ ignoredWords: ensure().settings.ignoredWords.slice(), defaults: DEFAULT_IGNORED.slice() }),
    set: (s = {}) => {
        if (Array.isArray(s.ignoredWords)) { ensure().settings.ignoredWords = s.ignoredWords.map((w) => String(w).trim()).filter(Boolean).slice(0, 200); touch(); }
        return settings.get();
    }
};

module.exports = {
    open, load, merge, mergeRange, cutsBetween, cutAt, edit, stats, prune, flush, settings,
    isOpen: () => !!data,
    _test: {
        reset: (file) => { shortAt.clear(); clearTimeout(writeTimer); writeTimer = null; data = null; dirty = false; writing = null; filePath = file ? String(file) : ''; if (filePath) load(); },
        data: () => ensure(), isPlaceholder, ignoredSet, writeFile, WRITE_EVERY_MS
    }
};
