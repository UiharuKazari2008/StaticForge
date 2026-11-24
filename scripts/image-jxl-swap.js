#!/usr/bin/env node
/**
 * #1134: put the JPEG XL copies made by the backlog run (staging, /home/kanmi/jxl-staging) into images/ in place
 * of their PNGs. Only once the storage layer (modules/imageStore.js) is live on the running server.
 *
 *   node scripts/image-jxl-swap.js [--dry-run] [--limit N] [--staging DIR] [--no-idle-wait]
 *
 * Per picture, in order: the PNG must still be the one that was converted (sha256 and mtime as recorded); its
 * metadata chunks go into the JXL's sfPN box (imageStore.attachPngMetadata); the box is read back; one picture in
 * 25 (and the first ten) is decoded in full and compared with the PNG (pixels via sharp raw, and the text chunks);
 * x.jxl is written via a temp file with the PNG's mtime; only then is x.png removed. Anything that does not match
 * is skipped and logged, its PNG left as it is. The staged copy is deleted once its picture is swapped. Progress: <staging>/swapped.ndjson, skips: swap-skipped.ndjson.
 * Runs at nice 19 / idle I/O and only while Dreamscape is idle (scripts/director-idle-check.js exit 0, checked
 * every 200 pictures); touch <staging>/STOP-SWAP to stop. Rerun to resume.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const store = require('../modules/imageStore');
// what a picture carries besides its pixels, in neutral form (#1156): text fields + extras (pixel density, EXIF)
const pictureMeta = require('../modules/pictureMeta');
const metaKey = (buf) => JSON.stringify([pictureMeta.readFields(buf), pictureMeta.extrasOf(buf)]);

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const LIMIT = parseInt(opt('--limit', '0'), 10) || 0;
const STAGING = opt('--staging', '/home/kanmi/jxl-staging');
const IDLE_WAIT = !args.includes('--no-idle-wait');
const FULL_CHECK_EVERY = 25;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const log = (m) => { const d = new Date(); console.log(new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ') + ' ' + m); };
const append = (f, rec) => fs.appendFileSync(path.join(STAGING, f), JSON.stringify(rec) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readNdjson(f) {
    const p = path.join(STAGING, f);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

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

async function main() {
    try { os.setPriority(19); } catch (_) { /* not allowed */ }
    try { execFileSync('ionice', ['-c', '3', '-p', String(process.pid)]); } catch (_) { /* no ionice */ }
    const done = readNdjson('done.ndjson');
    const finished = new Set([...readNdjson('swapped.ndjson'), ...readNdjson('swap-skipped.ndjson')].map((r) => r.name));
    const todo = done.filter((r) => !finished.has(r.name));
    log(`${todo.length} to swap of ${done.length} staged${DRY ? ' (dry run)' : ''}`);
    let n = 0, swapped = 0, skipped = 0, freed = 0;
    for (const r of todo) {
        if (LIMIT && n >= LIMIT) break;
        if (fs.existsSync(path.join(STAGING, 'STOP-SWAP'))) { log('STOP-SWAP: stopping'); break; }
        if (IDLE_WAIT && n % 200 === 0) {
            while (!idle()) { log('not idle, waiting 2 min'); await sleep(120000); }
        }
        n++;
        const skip = (why) => { skipped++; if (!DRY) append('swap-skipped.ndjson', { name: r.name, why }); log(`skip ${r.name}: ${why}`); };
        const pngP = path.join(store.IMAGES_DIR, r.name);
        const jxlP = path.join(store.IMAGES_DIR, store.jxlNameFor(r.name));
        const staged = path.join(STAGING, 'files', r.name.slice(0, -4) + '.jxl');
        let png, st;
        try { png = fs.readFileSync(pngP); st = fs.statSync(pngP); } catch (_) { skip('png gone'); continue; }
        if (fs.existsSync(jxlP)) { skip('jxl already in images'); continue; }
        if (sha(png) !== r.png_sha) { skip('png changed since conversion'); continue; }
        if (Math.abs(st.mtimeMs / 1000 - r.png_mtime) > 1) { skip('png mtime changed'); continue; }
        let jxl;
        try { jxl = fs.readFileSync(staged); } catch (_) { skip('staged jxl missing'); continue; }
        if (sha(jxl) !== r.jxl_sha) { skip('staged jxl changed'); continue; }
        // the PNG's own times ride along: date created (birth) and modified stay the picture's
        const boxed = store.attachPngMetadata(jxl, png, { birthtimeMs: st.birthtimeMs, mtimeMs: st.mtimeMs });
        // the box read back must carry the PNG's fields and extras (#1156: sfMD, format-neutral)
        const want = metaKey(png);
        const got = metaKey(boxed);
        if (want !== got) { skip('metadata box readback differs'); continue; }
        if (DRY) { swapped++; freed += png.length - boxed.length; continue; }
        const tmp = jxlP + '.tmp';
        fs.writeFileSync(tmp, boxed);
        fs.utimesSync(tmp, st.atimeMs / 1000, st.mtimeMs / 1000); // numbers keep the sub-millisecond part
        if (swapped < 10 || n % FULL_CHECK_EVERY === 0) {
            let ok = false;
            try {
                const rebuilt = await store.decodeJxlToPngBuffer(tmp);
                ok = await samePixels(png, rebuilt) && metaKey(rebuilt) === want;
            } catch (e) { ok = false; }
            if (!ok) { fs.unlinkSync(tmp); skip('full decode check failed'); continue; }
        }
        fs.renameSync(tmp, jxlP);
        fs.unlinkSync(pngP);
        // the staged copy is now in images/ (with its box): keeping it would hold the space twice
        try { fs.unlinkSync(staged); } catch (_) { /* gone */ }
        swapped++;
        freed += png.length - boxed.length;
        append('swapped.ndjson', { name: r.name, png_size: png.length, jxl_size: boxed.length, at: Date.now() });
        if (swapped % 500 === 0) log(`${swapped} swapped, ${(freed / 1e9).toFixed(2)} GB freed`);
    }
    log(`done: ${swapped} ${DRY ? 'would be ' : ''}swapped, ${skipped} skipped, ${(freed / 1e9).toFixed(2)} GB ${DRY ? 'would be ' : ''}freed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
