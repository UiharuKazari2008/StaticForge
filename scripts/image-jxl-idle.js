#!/usr/bin/env node
/**
 * #1134: the host's own JPEG XL upkeep. New pictures are written as JPEG XL at once (imageStore.writePicture, a
 * fast effort 3); PNG is legacy (Yukimi, Nov 24 2026). Each night, while the host is idle:
 *   1. any PNG still in images/ (written by legacy code) older than an hour becomes lossless JXL (effort 7);
 *   2. JXLs written at a lower effort and older than a day are re-encoded at effort 7 (same pixels, same
 *      metadata and times boxes, same mtime; kept only when smaller).
 * Pictures keep their name x.png for everything else (modules/imageStore.js).
 *
 *   node scripts/image-jxl-idle.js [--dry-run] [--limit N] [--min-age-hours 1] [--upgrade-age-hours 24]
 *
 * Meant to run once a night (crontab); it does what is due and exits. It runs at nice 19 / idle I/O, and only
 * while Dreamscape is idle (scripts/director-idle-check.js exit 0 and load under 60 % of the cores), checked
 * before every picture; when the host gets busy it stops and the rest waits for the next night.
 * Per picture: cjxl -d 0 -e 7, full decode compared with the PNG (pixels and metadata chunks), the PNG's metadata
 * in the sfPN box, x.jxl written via a temp file with the PNG's mtime, then x.png removed. A picture that fails is
 * left as PNG and listed in .cache/image-jxl/failed.ndjson (not tried again). Log: .cache/image-jxl/idle.log.
 * Re-encodes: decode, effort 7, decode again and compare pixels and metadata chunks; a failure leaves the file.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const store = require('../modules/imageStore');

const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, '.cache', 'image-jxl');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const LIMIT = parseInt(opt('--limit', '0'), 10) || 0;
const MIN_AGE_MS = (parseFloat(opt('--min-age-hours', '1')) || 1) * 3600000;
const UPGRADE_AGE_MS = (parseFloat(opt('--upgrade-age-hours', '24')) || 24) * 3600000;
const TARGET_EFFORT = 7;

fs.mkdirSync(STATE, { recursive: true });
const log = (m) => {
    const d = new Date();
    const line = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ') + ' ' + m;
    console.log(line);
    fs.appendFileSync(path.join(STATE, 'idle.log'), line + '\n');
};

function idle() {
    try {
        execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'director-idle-check.js')], { stdio: 'ignore' });
        return os.loadavg()[0] < os.cpus().length * 0.6;
    } catch (_) {
        return false;
    }
}

async function samePixels(a, b) {
    const [x, y] = await Promise.all([a, b].map((buf) => sharp(buf).raw().toBuffer({ resolveWithObject: true })));
    return x.info.width === y.info.width && x.info.height === y.info.height && x.info.channels === y.info.channels
        && x.data.equals(y.data);
}

const chunkKey = (buf) => store.metadataChunks(buf).map((c) => c.raw.toString('base64')).join(',');

async function convertOne(name) {
    const pngP = path.join(store.IMAGES_DIR, name);
    const jxlP = path.join(store.IMAGES_DIR, store.jxlNameFor(name));
    const raw = jxlP + '.enc.tmp';
    const tmp = jxlP + '.tmp';
    const st = fs.statSync(pngP);
    const png = fs.readFileSync(pngP);
    try {
        execFileSync('cjxl', [pngP, raw, '-d', '0', '-e', '7', '--num_threads=2', '--quiet'], { stdio: 'ignore' });
        // the PNG's own times ride along: date created (birth) and modified stay the picture's
        const boxed = store.attachPngMetadata(fs.readFileSync(raw), png, { birthtimeMs: st.birthtimeMs, mtimeMs: st.mtimeMs, effort: TARGET_EFFORT });
        fs.writeFileSync(tmp, boxed);
        const rebuilt = await store.decodeJxlToPngBuffer(tmp);
        if (!(await samePixels(png, rebuilt)) || chunkKey(rebuilt) !== chunkKey(png)) throw new Error('decode check failed');
        // the PNG must not have changed while it was being converted
        const now = fs.statSync(pngP);
        if (now.mtimeMs !== st.mtimeMs || now.size !== st.size) throw new Error('png changed during conversion');
        fs.utimesSync(tmp, st.atimeMs / 1000, st.mtimeMs / 1000); // numbers keep the sub-millisecond part
        fs.renameSync(tmp, jxlP);
        fs.unlinkSync(pngP);
        return png.length - boxed.length;
    } finally {
        for (const f of [raw, tmp]) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
    }
}

/** A JXL written at a lower effort, re-encoded at effort 7; resolves the bytes saved (0 when not smaller). */
async function upgradeOne(file) {
    const jxlP = path.join(store.IMAGES_DIR, file);
    const st = fs.statSync(jxlP);
    const times = store.readFileTimesSync(jxlP);
    if (!times) return 0;
    const pngTmp = jxlP + '.up.png';
    const raw = jxlP + '.up.jxl';
    const tmp = jxlP + '.tmp';
    try {
        const png = await store.decodeJxlToPngBuffer(jxlP);
        fs.writeFileSync(pngTmp, png);
        execFileSync('cjxl', [pngTmp, raw, '-d', '0', '-e', String(TARGET_EFFORT), '--num_threads=2', '--quiet'], { stdio: 'ignore' });
        const boxed = store.attachPngMetadata(fs.readFileSync(raw), png, {
            birthtimeMs: times.birthtimeMs, mtimeMs: times.mtimeMs, effort: TARGET_EFFORT
        });
        if (boxed.length >= st.size) return 0;
        fs.writeFileSync(tmp, boxed);
        const again = await store.decodeJxlToPngBuffer(tmp);
        if (!(await samePixels(png, again)) || chunkKey(again) !== chunkKey(png)) throw new Error('re-encode check failed');
        const now = fs.statSync(jxlP);
        if (now.mtimeMs !== st.mtimeMs || now.size !== st.size) throw new Error('picture changed during re-encode');
        fs.utimesSync(tmp, st.atimeMs / 1000, st.mtimeMs / 1000);
        fs.renameSync(tmp, jxlP);
        return st.size - boxed.length;
    } finally {
        for (const f of [pngTmp, raw, tmp]) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
    }
}

async function main() {
    try { os.setPriority(19); } catch (_) { /* not allowed */ }
    try { execFileSync('ionice', ['-c', '3', '-p', String(process.pid)]); } catch (_) { /* no ionice */ }
    const failedP = path.join(STATE, 'failed.ndjson');
    const failed = new Set(fs.existsSync(failedP)
        ? fs.readFileSync(failedP, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).name) : []);
    const cutoff = Date.now() - MIN_AGE_MS;
    const upgradeCutoff = Date.now() - UPGRADE_AGE_MS;
    const due = [];
    const upgrades = [];
    for (const e of fs.readdirSync(store.IMAGES_DIR, { withFileTypes: true })) {
        if (!e.isFile() || e.name.startsWith('.') || failed.has(e.name)) continue;
        if (/\.png$/i.test(e.name)) {
            const st = fs.statSync(path.join(store.IMAGES_DIR, e.name));
            if (st.mtimeMs < cutoff) due.push({ name: e.name, mtimeMs: st.mtimeMs });
        } else if (/\.jxl$/i.test(e.name)) {
            const p = path.join(store.IMAGES_DIR, e.name);
            const t = store.readFileTimesSync(p);
            if (t && t.effort > 0 && t.effort < TARGET_EFFORT && fs.statSync(p).mtimeMs < upgradeCutoff) upgrades.push(e.name);
        }
    }
    due.sort((a, b) => a.mtimeMs - b.mtimeMs);
    log(`${due.length} PNG to convert, ${upgrades.length} JXL to re-encode at effort ${TARGET_EFFORT}${DRY ? ' (dry run)' : ''}`);
    if (DRY) return;
    let n = 0, freed = 0;
    for (const d of due) {
        if (LIMIT && n >= LIMIT) break;
        if (!idle()) { log(`host busy: stopping after ${n} (rest next run)`); break; }
        try {
            freed += await convertOne(d.name);
            n++;
        } catch (e) {
            fs.appendFileSync(failedP, JSON.stringify({ name: d.name, err: String(e.message).slice(0, 300), at: Date.now() }) + '\n');
            log(`failed ${d.name}: ${e.message}`);
        }
    }
    let u = 0;
    for (const file of upgrades) {
        if (LIMIT && n + u >= LIMIT) break;
        if (!idle()) { log(`host busy: stopping re-encodes after ${u} (rest next run)`); break; }
        try {
            freed += await upgradeOne(file);
            u++;
        } catch (e) {
            fs.appendFileSync(failedP, JSON.stringify({ name: file, err: String(e.message).slice(0, 300), at: Date.now() }) + '\n');
            log(`re-encode failed ${file}: ${e.message}`);
        }
    }
    log(`converted ${n}, re-encoded ${u}, ${(freed / 1e6).toFixed(0)} MB freed`);
}

main().catch((e) => { log('error: ' + (e && e.stack || e)); process.exit(1); });
