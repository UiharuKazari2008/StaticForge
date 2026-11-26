#!/usr/bin/env node
'use strict';
// Lizumi S7 (Yozora #1252): deferred assembly. Nothing is filed while a recording runs; its files are built from the segments on
// disk and the cut store when it stops, and again on demand. No SiriusXM network (a stubbed pump), real ffmpeg and ffprobe, a
// fake file store for the tape.
//   - song and long mode build the same files (names, tags, chapters) the in-flight filing built; nothing is filed while recording
//   - a one-cut kind still stops when its cut ends, and files only that cut
//   - assembling again gives the same set of files, and the tape keeps one copy (the same name is replaced, never "(2)")
//   - a hole becomes AAC silence of its exact length (to the frame) and is marked in the title, the comment and a chapter
//   - the segments are kept keepSegmentsHours after a successful assembly and then go; a failed or unassembled one stays
//   - an assembly cut short by a crash (assembly.json 'assembling') runs again when the recorder starts
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const EventEmitter = require('events');

const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmasm-'));
const account = path.join(dir, 'xmradio-account.json');
fs.writeFileSync(account, '{}');
const spool = path.join(dir, 'xmradio-spool');
const recRoot = path.join(dir, 'xmradio-rec');

// ---- a fake file store (the tape): folders by name, files by name; saveUserFileFromPath honours overwrite like the VFS
const folders = new Map(); // id -> { id, name, parent_id }
const files = []; // { id, original_name, folder_id, bytes }
let nextId = 1;
const fakeVfs = {
    _findWorkspaceFolderByName: async (ws, parent, name) => [...folders.values()].find((f) => f.name === name && (f.parent_id || null) === (parent || null)) || null,
    createFolderAtPath: async (p, name) => {
        const parent = p.split('/').pop();
        const f = { id: `f${nextId++}`, name, parent_id: /^f\d+$/.test(parent) ? parent : null };
        folders.set(f.id, f);
        return f;
    },
    saveUserFileFromPath: async (tmp, o) => {
        const bytes = fs.readFileSync(tmp);
        if (o.overwrite) {
            const keep = files.find((f) => f.folder_id === o.folderId && f.original_name.toLowerCase() === o.originalName.toLowerCase());
            if (keep) { keep.bytes = bytes; keep.version = (keep.version || 1) + 1; return keep; }
        }
        const f = { id: `u${nextId++}`, original_name: o.originalName, folder_id: o.folderId, bytes, version: 1 };
        files.push(f);
        return f;
    }
};
const fakeDb = { getUserFilesByLocation: async (scope, ws, folderId) => files.filter((f) => f.folder_id === folderId) };
const dbPath = require.resolve('../modules/vfsDatabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

// ---- the fixture: 60 s of a sine as ADTS AAC, cut into ten segments of 258 whole frames (5.99 s)
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=62:sample_rate=44100', '-ac', '2', '-c:a', 'aac', '-b:a', '64k', '-f', 'adts', path.join(dir, 'all.aac')]);
const all = fs.readFileSync(path.join(dir, 'all.aac'));
const recorder = require('../modules/xmRadioRecorder');
const { adtsFrames } = recorder._test;
const frames = adtsFrames(all);
const PER = 258;
const SEGS = 10;
assert.ok(frames.length >= PER * SEGS, 'fixture long enough');
const id3 = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(64)]);
const chunk = (i) => { const f = frames.slice(i * PER, (i + 1) * PER); return all.subarray(f[0].off, f[f.length - 1].off + f[f.length - 1].len); };
const SEG_S = PER * 1024 / 44100; // seconds per segment
const T = Date.now() - 400000;
const pdtOf = (i) => Math.round(T + i * SEG_S * 1000);

const pumps = [];
const pump = require('../modules/xmRadioPump');
pump.createPump = (o) => {
    const e = new EventEmitter();
    e.start = () => { pumps.push(e); };
    e.stop = () => {};
    return e;
};
const emitSeg = (p, i) => p.emit('segment', { seq: 100 + i, pdt: pdtOf(i), dur: SEG_S, plain: Buffer.concat([id3, chunk(i)]) });
const CHANNEL = 'abcd1234abcd1234abcd1234';
const cuts = [
    { at: T, a: 'Artist A', t: 'Song A', s: '', ik: '', ad: false },
    { at: T + 20000, a: 'Artist B', t: 'Song B', s: '', ik: '', ad: false },
    { at: T + 45000, a: 'Artist C', t: 'Song C', s: '', ik: '', ad: false }
];
const gr = { getVfsManager: () => fakeVfs, getWebSocketServer: () => null };
recorder.init({
    accountFilePath: () => account,
    channelById: (id) => (id === CHANNEL ? { name: 'The Spectrum', number: 22 } : null),
    nowPlayingCuts: () => cuts.map((c) => Object.assign({}, c)), watch: () => {}, onLook: () => {}, imageUrlFor: () => ''
}, gr, { resumeMs: 1e9 });

const until = async (cond, what, ms = 15000) => {
    for (let i = 0; i < ms / 20 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(await cond(), `timed out: ${what}`);
};
const spoolNames = () => (fs.existsSync(spool) ? fs.readdirSync(spool).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(spool, f), 'utf8'))) : []);
const spoolFile = (name) => {
    const j = fs.readdirSync(spool).filter((f) => f.endsWith('.json')).find((f) => JSON.parse(fs.readFileSync(path.join(spool, f), 'utf8')).name === name);
    return path.join(spool, j.replace(/\.json$/, '.m4a'));
};
const probe = (file, entries) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'json', file]).toString());
const tagsOf = (file) => probe(file, 'format_tags=title,artist,album,track,comment,date').format.tags || {};
const durOf = (file) => Number(probe(file, 'format=duration').format.duration);
const chaptersOf = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file]).toString()).chapters;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}${pad(d.getMinutes())}`; };
const hms = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const wipe = () => {
    recorder._test.reset();
    pumps.length = 0;
    fs.rmSync(spool, { recursive: true, force: true });
    fs.rmSync(recRoot, { recursive: true, force: true });
    folders.clear(); files.length = 0;
};
const startRec = async (o) => recorder.start(Object.assign({ channelId: CHANNEL, back: Math.round((Date.now() - T) / 1000) }, o));
const nameA = `${ymd(T)} ${hm(T)} Artist A - Song A`;
const nameB = `${ymd(T + 20000)} ${hm(T + 20000)} Artist B - Song B`;
const nameC = `${ymd(T + 45000)} ${hm(T + 45000)} Artist C - Song C`;

(async () => {
    // 1. song mode: nothing is filed while it records; the buffer state and counters are on the deck; the stop assembles
    const r1 = await startRec({ mode: 'song', kind: 'manual' });
    const p1 = pumps[0];
    const rec1 = recorder._test.recs.get(r1.rid);
    for (let i = 0; i < 2; i++) emitSeg(p1, i);
    assert.strictEqual(recorder.deck().recordings[0].state, 'buffering', 'fewer than healthyBuffer segments held');
    for (let i = 2; i < SEGS; i++) emitSeg(p1, i);
    await rec1.write;
    const d1 = recorder.deck().recordings[0];
    assert.strictEqual(d1.state, 'recording');
    assert.strictEqual(d1.held, SEGS);
    assert.strictEqual(d1.segsWritten, SEGS);
    assert.strictEqual(d1.segsExpected, SEGS, 'expected = (position - start) / mean segment length');
    assert.deepStrictEqual([d1.gaps.length, d1.gapSeconds, d1.refetches, d1.pauses], [0, 0, 0, 0]);
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(spoolNames().length, 0, 'nothing is filed while it records (A and B are long over)');
    assert.strictEqual(rec1.meta.filed, 0);
    assert.ok(fs.readdirSync(path.join(recRoot, r1.rid)).filter((f) => /^s\d+\.aac$/.test(f)).length === SEGS, 'every segment stays on disk');
    assert.strictEqual(recorder.held()[0].state, 'recording');
    await recorder.stop(r1.rid);
    let names = spoolNames().map((j) => j.name).sort();
    assert.deepStrictEqual(names, [nameA, nameB, nameC].sort(), 'a file per cut, the names the in-flight filing made');
    const a = tagsOf(spoolFile(nameA));
    assert.deepStrictEqual([a.title, a.artist, a.album, a.track], ['Song A', 'Artist A', '22 The Spectrum', '1']);
    assert.ok(/^Recorded from SiriusXM The Spectrum on /.test(a.comment) && !/missing/.test(a.comment), a.comment);
    assert.ok(Math.abs(durOf(spoolFile(nameA)) - 20) < 0.1, `A lasts ${durOf(spoolFile(nameA))}`);
    const b = tagsOf(spoolFile(nameB));
    assert.deepStrictEqual([b.title, b.track], ['Song B', '2']);
    assert.ok(Math.abs(durOf(spoolFile(nameB)) - 25) < 0.1);
    const c = tagsOf(spoolFile(nameC));
    assert.deepStrictEqual([c.title, c.track], ['Song C (partial)', '3'], 'the cut the stop cut off is partial');
    assert.ok(Math.abs(durOf(spoolFile(nameC)) - (SEGS * SEG_S - 45)) < 0.1);
    const h1 = recorder.held().find((h) => h.rid === r1.rid);
    assert.strictEqual(h1.state, 'assembled');
    assert.deepStrictEqual(h1.files.slice().sort(), names.map((n) => `${n}.m4a`).sort());
    const asm = JSON.parse(fs.readFileSync(path.join(recRoot, r1.rid, 'assembly.json'), 'utf8'));
    assert.strictEqual(asm.state, 'done');
    assert.ok(asm.at > 0 && Array.isArray(asm.gaps) && asm.gaps.length === 0 && asm.error === null);
    assert.ok(h1.keepUntil > Date.now() + 23 * 3600000, 'the segments are kept for keepSegmentsHours (24)');
    assert.ok(recorder._test.keepArmed(), 'one timer to the soonest expiry');
    assert.ok(fs.existsSync(path.join(recRoot, r1.rid, 's100.aac')), 'segments kept after assembly');
    console.log('ok 1 - song mode: nothing filed while recording, the same files after the stop, counters on the deck');

    // 2. assembling again: the same file set (re-runnable), the tape keeps one copy
    const before = spoolNames();
    assert.ok(before.every((j) => j.replace === false), 'the first assembly adds files');
    for (const id of await recorder.spoolList()) await recorder.importSpool(id);
    const tape = [...folders.values()].find((f) => f.name === 'Tape 1');
    const onTape = () => files.filter((f) => f.folder_id === tape.id).map((f) => f.original_name).sort();
    assert.deepStrictEqual(onTape(), [nameA, nameB, nameC].map((n) => `${n}.m4a`).sort(), 'on the tape after the first assembly');
    const sizesBefore = files.map((f) => f.bytes.length);
    const again = await recorder.assemble(r1.rid);
    assert.strictEqual(again.state, 'assembled');
    assert.deepStrictEqual(again.files.slice().sort(), h1.files.slice().sort(), 'assembling twice gives the same file set');
    const after = spoolNames();
    assert.deepStrictEqual(after.map((j) => j.name).sort(), names, 'the same names');
    assert.ok(after.every((j) => j.replace === true), 're-filed over the earlier files');
    // a re-assembly that is run before the first spool entries were imported overwrites them in place (one entry per name)
    assert.strictEqual(fs.readdirSync(spool).filter((f) => f.endsWith('.json')).length, 3);
    for (const id of await recorder.spoolList()) await recorder.importSpool(id);
    assert.deepStrictEqual(onTape(), [nameA, nameB, nameC].map((n) => `${n}.m4a`).sort(), 'one copy on the tape: no "(2)"');
    assert.deepStrictEqual(files.map((f) => f.bytes.length), sizesBefore, 'the same bytes');
    assert.ok(files.every((f) => f.version === 2), 'each file was replaced, not added');
    assert.strictEqual(fs.readdirSync(spool).length, 0, 'the spool is empty once imported');
    // a first assembly of another recording with the same names still adds "(2)" (only a re-assembly replaces)
    const dupDir = path.join(spool);
    fs.mkdirSync(dupDir, { recursive: true });
    fs.writeFileSync(path.join(dupDir, '0'.repeat(24) + '.m4a'), Buffer.from('x'));
    fs.writeFileSync(path.join(dupDir, '0'.repeat(24) + '.json'), JSON.stringify({ workspaceId: 'default', tape: 'Tape 1', name: nameA, replace: false }));
    await recorder.importSpool('0'.repeat(24));
    assert.ok(onTape().includes(`${nameA} (2).m4a`), 'a different recording of the same song keeps its own file');
    console.log('ok 2 - assemble again: the same file set, the tape keeps one copy');

    // 3. long mode: one file, a chapter per cut
    wipe();
    const r3 = await startRec({ mode: 'long', kind: 'manual' });
    for (let i = 0; i < SEGS; i++) emitSeg(pumps[0], i);
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(spoolNames().length, 0, 'nothing filed while it records');
    await recorder.stop(r3.rid);
    assert.deepStrictEqual(spoolNames().map((j) => j.name), [`${ymd(T)} ${hm(T)} The Spectrum`]);
    const longFile = spoolFile(`${ymd(T)} ${hm(T)} The Spectrum`);
    const lt = tagsOf(longFile);
    assert.strictEqual(lt.artist, 'The Spectrum');
    assert.ok(/^The Spectrum, /.test(lt.title), lt.title);
    assert.ok(!lt.comment, 'a complete recording carries no missing-audio comment');
    const ch = chaptersOf(longFile);
    assert.deepStrictEqual(ch.map((c) => c.tags.title), ['Artist A - Song A', 'Artist B - Song B', 'Artist C - Song C']);
    assert.ok(Math.abs(Number(ch[1].start_time) - 20) < 0.05 && Math.abs(Number(ch[2].start_time) - 45) < 0.05, 'chapters at the cuts');
    assert.ok(Math.abs(durOf(longFile) - SEGS * SEG_S) < 0.1);
    console.log('ok 3 - long mode: one file with a chapter per cut');

    // 4. a one-cut recording (a term) stops when its cut ends and files only that cut; nothing is filed before
    wipe();
    const r4 = await startRec({ mode: 'song', kind: 'term', fromCut: T });
    for (let i = 0; i < 3; i++) emitSeg(pumps[0], i); // 17.97 s: cut A (20 s) has not ended
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(recorder._test.recs.has(r4.rid), 'still recording before its cut ends');
    assert.strictEqual(spoolNames().length, 0);
    emitSeg(pumps[0], 3); // 23.96 s: cut B has started
    await until(() => !recorder._test.recs.has(r4.rid) && recorder.held().find((h) => h.rid === r4.rid && h.state === 'assembled'), 'stopped itself and assembled');
    assert.deepStrictEqual(spoolNames().map((j) => j.name), [nameA], 'only its cut is filed');
    assert.strictEqual(tagsOf(spoolFile(nameA)).title, 'Song A', 'a whole cut, not partial');
    assert.ok(Math.abs(durOf(spoolFile(nameA)) - 20) < 0.1);
    console.log('ok 4 - a one-cut kind stops when its cut ends and files only that cut');

    // 5. a hole: the pump says audio left the window (song mode); in long mode the recorder sees the jump itself
    wipe();
    const r5 = await startRec({ mode: 'song', kind: 'manual' });
    const p5 = pumps[0];
    emitSeg(p5, 0);
    const gapFrom = pdtOf(0) + SEG_S * 1000;
    const gapTo = pdtOf(3);
    p5.emit('gap', { from: gapFrom, to: gapTo }); // segments 1 and 2 left the window
    for (let i = 3; i < SEGS; i++) emitSeg(p5, i);
    await recorder._test.recs.get(r5.rid).write;
    const d5 = recorder.deck().recordings[0];
    assert.strictEqual(d5.gaps.length, 1);
    assert.deepStrictEqual([d5.gaps[0].from, d5.gaps[0].to], [gapFrom, gapTo]);
    assert.strictEqual(d5.gapSeconds, Math.round((gapTo - gapFrom) / 1000));
    assert.strictEqual(d5.held, SEGS - 2);
    assert.ok(d5.segsExpected > d5.segsWritten, 'expected counts the missing segments');
    const rows = fs.readFileSync(path.join(recRoot, r5.rid, 'segs.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepStrictEqual(rows.find((x) => x.gap), { gap: true, from: gapFrom, to: gapTo }, 'the gap is a row in segs.ndjson');
    assert.ok(rows.findIndex((x) => x.gap) < rows.findIndex((x) => x.seq === 103), 'before the segment that follows it');
    const list = recorder.playlist(r5.rid);
    assert.ok(list.indexOf('#EXT-X-DISCONTINUITY') > 0, 'the growing playlist has a discontinuity at the hole');
    const rec5 = recorder._test.recs.get(r5.rid);
    // exact length of the silence: to the frame (1024 samples)
    const view = { meta: rec5.meta, dir: rec5.dir, segs: rec5.segs.slice(), gaps: rec5.gaps.slice(), cuts: rec5.cuts };
    const tmpAac = path.join(dir, 'all-slice.aac');
    const total = adtsFrames(fs.readFileSync(await (async () => { await recorder._test.sliceAac(view, pdtOf(0), pdtOf(SEGS - 1) + SEG_S * 1000 + 1, tmpAac); return tmpAac; })())).length;
    const silent = total - (SEGS - 2) * PER;
    const frameMs = 1024000 / 44100;
    assert.ok(Math.abs(silent * frameMs - (gapTo - gapFrom)) <= frameMs, `silence is ${silent} frames = ${(silent * frameMs).toFixed(1)} ms for a ${(gapTo - gapFrom).toFixed(1)} ms gap`);
    await recorder.stop(r5.rid);
    names = spoolNames().map((j) => j.name).sort();
    const nameAgap = `${nameA} (gap)`;
    assert.deepStrictEqual(names, [nameAgap, nameB, nameC].sort(), 'only the cut with the hole in it is marked');
    const ga = tagsOf(spoolFile(nameAgap));
    assert.strictEqual(ga.title, 'Song A (gap)', 'the title carries the marker');
    assert.ok(ga.comment.includes(`missing audio ${hms(gapFrom)}-${hms(gapTo)}`), ga.comment);
    assert.ok(/missing audio \d\d:\d\d:\d\d-\d\d:\d\d:\d\d/.test(ga.comment));
    assert.ok(Math.abs(durOf(spoolFile(nameAgap)) - 20) < 0.1, 'the hole is silence, so the cut keeps its length and later times stay true');
    // the hole really is silent, and where it should be
    const sd = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', spoolFile(nameAgap), '-af', 'silencedetect=noise=-60dB:d=2', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const ss = Number((/silence_start: ([\d.]+)/.exec(sd) || [])[1]);
    const sdur = Number((/silence_duration: ([\d.]+)/.exec(sd) || [])[1]);
    assert.ok(Math.abs(ss - SEG_S) < 0.15 && Math.abs(sdur - (gapTo - gapFrom) / 1000) < 0.15, `silence at ${ss} for ${sdur} s`);
    assert.ok(!/missing/.test(tagsOf(spoolFile(nameB)).comment), 'the cuts either side are untouched');
    assert.strictEqual(tagsOf(spoolFile(nameB)).title, 'Song B');
    const h5 = recorder.held().find((h) => h.rid === r5.rid);
    assert.strictEqual(h5.gaps.length, 1);
    assert.strictEqual(h5.gapSeconds, 12);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(recRoot, r5.rid, 'assembly.json'), 'utf8')).gaps.length, 1, 'assembly.json lists the gaps');
    // long mode, the recorder noticing the jump itself (a pump that did not say): a chapter over the hole and the comment
    wipe();
    const r6 = await startRec({ mode: 'long', kind: 'manual' });
    emitSeg(pumps[0], 0);
    for (let i = 3; i < SEGS; i++) emitSeg(pumps[0], i);
    await recorder._test.recs.get(r6.rid).write;
    assert.strictEqual(recorder.deck().recordings[0].gaps.length, 1, 'the recorder marks a jump the pump did not');
    await recorder.stop(r6.rid);
    const lf = spoolFile(`${ymd(T)} ${hm(T)} The Spectrum`);
    const lc = chaptersOf(lf);
    const miss = lc.filter((c) => c.tags.title === 'Missing audio');
    assert.strictEqual(miss.length, 1, 'a chapter over the hole');
    const gp = recorder.held().find((h) => h.rid === r6.rid).gaps[0];
    assert.ok(Math.abs(Number(miss[0].start_time) - (gp.from - pdtOf(0)) / 1000) < 0.05 && Math.abs(Number(miss[0].end_time) - (gp.to - pdtOf(0)) / 1000) < 0.05, `chapter ${miss[0].start_time}-${miss[0].end_time}`);
    assert.ok(lc.length >= 4 && lc.every((c, i) => i === 0 || Number(c.start_time) >= Number(lc[i - 1].end_time) - 0.01), 'the chapters do not overlap');
    assert.ok(tagsOf(lf).comment.includes('missing audio '), tagsOf(lf).comment);
    assert.ok(Math.abs(durOf(lf) - (SEGS * SEG_S)) < 0.15, 'the long file spans the hole, later times stay true');
    console.log('ok 5 - a hole is silence of its exact length, marked in title, comment and chapter, never presented as complete');

    // 6. keeping and removing the segments: keepSegmentsHours, a failed or unassembled recording stays, one sweep and one timer
    const rid6 = r6.rid;
    assert.throws(() => recorder.setSettings({ keepSegmentsHours: -1 }), /Hours to keep segments is 0 to 720/);
    assert.throws(() => recorder.setSettings({ healthyBuffer: 0 }), /healthy buffer is 1 to 20/);
    assert.throws(() => recorder.setSettings({ behindSeconds: 5 }), /30 to 3600/);
    assert.throws(() => recorder.setSettings({ refetchRetries: 11 }), /0 to 10/);
    const set = recorder.setSettings({ keepSegmentsHours: 2, healthyBuffer: 4, behindSeconds: 90, refetchRetries: 1 }).settings;
    assert.deepStrictEqual([set.keepSegmentsHours, set.healthyBuffer, set.behindSeconds, set.refetchRetries, set.streamsPerAccount], [2, 4, 90, 1, 1]);
    const E = recorder._test.ended;
    const rec6 = E.get(rid6);
    const done = rec6.assembly.at;
    assert.strictEqual(recorder.held().find((h) => h.rid === rid6).keepUntil, done + 2 * 3600000, 'keepUntil follows the setting');
    await recorder._test.sweepExpired(done + 3600000);
    assert.ok(E.has(rid6) && fs.existsSync(rec6.dir), 'not yet');
    // a failed one and a never-assembled one are kept however old
    const mk = async (state) => {
        const r = await startRec({ mode: 'song', kind: 'manual' });
        emitSeg(pumps[pumps.length - 1], 0);
        await recorder._test.recs.get(r.rid).write;
        await recorder.stop(r.rid);
        const rec = E.get(r.rid);
        if (state === 'failed') rec.assembly = Object.assign({}, rec.assembly, { state: 'failed', error: 'ffmpeg 1' });
        else delete rec.assembly;
        return rec;
    };
    const failedRec = await mk('failed');
    const rawRec = await mk('raw');
    assert.strictEqual(recorder.held().find((h) => h.rid === failedRec.meta.rid).state, 'failed');
    assert.strictEqual(recorder.held().find((h) => h.rid === rawRec.meta.rid).state, 'stopped');
    await recorder._test.sweepExpired(done + 3 * 3600000);
    assert.ok(!E.has(rid6) && !fs.existsSync(rec6.dir), 'the folder goes after keepSegmentsHours');
    assert.ok(E.has(failedRec.meta.rid) && fs.existsSync(failedRec.dir), 'a failed assembly keeps its segments');
    assert.ok(E.has(rawRec.meta.rid) && fs.existsSync(rawRec.dir), 'an unassembled recording keeps its segments');
    assert.ok(!recorder.held().some((h) => h.rid === rid6));
    await assert.rejects(() => recorder.assemble(rid6), /holds segments/);
    // the operator deletes them
    await recorder.heldDelete(failedRec.meta.rid);
    assert.ok(!E.has(failedRec.meta.rid) && !fs.existsSync(failedRec.dir));
    console.log('ok 6 - segments kept keepSegmentsHours, then removed; failed and unassembled ones stay until assembled or deleted');

    // 7. a crash mid-assembly: assembly.json says 'assembling'; the next start runs it again (the same names, over the old ones)
    wipe();
    const r7 = await startRec({ mode: 'song', kind: 'manual' });
    for (let i = 0; i < SEGS; i++) emitSeg(pumps[0], i);
    await recorder._test.recs.get(r7.rid).write;
    await recorder.stop(r7.rid);
    const dir7 = path.join(recRoot, r7.rid);
    const first = spoolNames().map((j) => j.name).sort();
    assert.strictEqual(first.length, 3);
    // the process died: memory gone, one file was spooled, the assembly was marked as running
    fs.rmSync(spool, { recursive: true, force: true });
    recorder._test.ended.clear();
    fs.writeFileSync(path.join(dir7, 'assembly.json'), JSON.stringify({ state: 'assembling', at: Date.now() - 1000, files: [], gaps: [], error: null }));
    recorder._test.load().active = [];
    await recorder._test.resume();
    await until(() => !recorder._test.assembling.size && recorder._test.ended.get(r7.rid) && recorder._test.ended.get(r7.rid).assembly.state === 'done', 'the assembly ran again');
    assert.deepStrictEqual(spoolNames().map((j) => j.name).sort(), first, 'the same files again');
    assert.ok(spoolNames().every((j) => j.replace === true), 'filed over whatever the cut-short run left on the tape');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir7, 'assembly.json'), 'utf8')).state, 'done');
    // a recording that was never assembled (no assembly.json at all) is assembled at startup too, a folder without meta.json goes
    fs.rmSync(spool, { recursive: true, force: true });
    recorder._test.ended.clear();
    fs.rmSync(path.join(dir7, 'assembly.json'));
    fs.mkdirSync(path.join(recRoot, 'orphan'));
    fs.writeFileSync(path.join(recRoot, 'orphan', 's1.aac'), 'x');
    await recorder._test.resume();
    await until(() => !recorder._test.assembling.size && spoolNames().length === 3, 'a never-assembled recording is assembled');
    assert.ok(!fs.existsSync(path.join(recRoot, 'orphan')), 'a folder no recording owns goes');
    assert.ok(spoolNames().every((j) => j.replace === false), 'a first assembly adds files');
    console.log('ok 7 - a crash mid-assembly (and a never-assembled recording) is assembled when the recorder starts');

    // 8. a recording that cannot carry on is assembled, not just filed (the resume of a recording whose time is up)
    wipe();
    const r8 = await startRec({ mode: 'song', kind: 'manual' });
    for (let i = 0; i < SEGS; i++) emitSeg(pumps[0], i);
    await recorder._test.recs.get(r8.rid).write;
    const st8 = recorder._test.load();
    st8.active = [Object.assign({}, recorder._test.recs.get(r8.rid).meta, { until: Date.now() - 60000 })];
    recorder._test.recs.clear();
    pumps.length = 0;
    await recorder._test.resume();
    await until(() => spoolNames().length === 3 && recorder.held().find((h) => h.rid === r8.rid && h.state === 'assembled'), 'assembled by the resume');
    console.log('ok 8 - resume assembles a recording that cannot carry on');
    console.log('test-xmradio-assembly: ok');
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* gone */ } setTimeout(() => process.exit(process.exitCode || 0), 50); });
