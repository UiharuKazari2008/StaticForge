#!/usr/bin/env node
/**
 * #1134: the host's own JPEG XL conversion, after the one-time backlog. Gallery PNGs older than 30 days become
 * lossless JXL (effort 7) in place, keeping their name x.png for everything else (modules/imageStore.js).
 *
 *   node scripts/image-jxl-idle.js [--dry-run] [--limit N] [--days 30]
 *
 * Meant to run once a night (crontab); it does what is due and exits. It runs at nice 19 / idle I/O, and only
 * while Dreamscape is idle (scripts/director-idle-check.js exit 0 and load under 60 % of the cores), checked
 * before every picture; when the host gets busy it stops and the rest waits for the next night.
 * Per picture: cjxl -d 0 -e 7, full decode compared with the PNG (pixels and metadata chunks), the PNG's metadata
 * in the sfPN box, x.jxl written via a temp file with the PNG's mtime, then x.png removed. A picture that fails is
 * left as PNG and listed in .cache/image-jxl/failed.ndjson (not tried again). Log: .cache/image-jxl/idle.log.
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
const DAYS = parseFloat(opt('--days', '30')) || 30;

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
        const boxed = store.attachPngMetadata(fs.readFileSync(raw), png, { birthtimeMs: st.birthtimeMs, mtimeMs: st.mtimeMs });
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

async function main() {
    try { os.setPriority(19); } catch (_) { /* not allowed */ }
    try { execFileSync('ionice', ['-c', '3', '-p', String(process.pid)]); } catch (_) { /* no ionice */ }
    const failedP = path.join(STATE, 'failed.ndjson');
    const failed = new Set(fs.existsSync(failedP)
        ? fs.readFileSync(failedP, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).name) : []);
    const cutoff = Date.now() - DAYS * 86400000;
    const due = [];
    for (const e of fs.readdirSync(store.IMAGES_DIR, { withFileTypes: true })) {
        if (!e.isFile() || !/\.png$/i.test(e.name) || e.name.startsWith('.') || failed.has(e.name)) continue;
        const st = fs.statSync(path.join(store.IMAGES_DIR, e.name));
        if (st.mtimeMs < cutoff) due.push({ name: e.name, mtimeMs: st.mtimeMs });
    }
    due.sort((a, b) => a.mtimeMs - b.mtimeMs);
    log(`${due.length} PNG older than ${DAYS} days${DRY ? ' (dry run)' : ''}`);
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
    log(`converted ${n}, ${(freed / 1e6).toFixed(0)} MB freed`);
}

main().catch((e) => { log('error: ' + (e && e.stack || e)); process.exit(1); });
