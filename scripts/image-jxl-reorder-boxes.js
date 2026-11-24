#!/usr/bin/env node
/**
 * #1134: move the sfPN metadata box of gallery JXLs behind the codestream. Early swaps wrote it first, and a
 * picture's metadata can be hundreds of KB: a client then downloaded all of it before it could draw anything, and
 * the size header sat far into the file. Only the container's box order changes (no re-encode): the file keeps
 * its bytes, size and mtime, so decoded copies, the size map and previews stay valid.
 *
 *   node scripts/image-jxl-reorder-boxes.js [--dry-run] [--dir images]
 *
 * Per file: boxes read; if sfPN comes before the codestream, the same boxes are written in the new order to a temp
 * file, read back and compared box by box, given the old mtime and renamed over. Runs at nice 19 / idle I/O.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const di = args.indexOf('--dir');
const DIR = di >= 0 ? path.resolve(args[di + 1]) : path.join(ROOT, 'images');
const SIG = Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);

function boxes(buf) {
    if (!buf.subarray(0, 12).equals(SIG)) return null;
    const out = [];
    let off = 0;
    while (off + 8 <= buf.length) {
        let size = buf.readUInt32BE(off);
        if (size === 1) size = Number(buf.readBigUInt64BE(off + 8));
        if (size === 0) size = buf.length - off;
        if (size < 8 || off + size > buf.length) return null;
        out.push({ type: buf.toString('latin1', off + 4, off + 8), raw: buf.subarray(off, off + size) });
        off += size;
    }
    return off === buf.length ? out : null;
}

function main() {
    try { os.setPriority(19); } catch (_) { /* not allowed */ }
    try { execFileSync('ionice', ['-c', '3', '-p', String(process.pid)]); } catch (_) { /* no ionice */ }
    let seen = 0, moved = 0, already = 0, skipped = 0;
    for (const name of fs.readdirSync(DIR)) {
        if (!/\.jxl$/i.test(name)) continue;
        seen++;
        const p = path.join(DIR, name);
        let buf, st;
        try { buf = fs.readFileSync(p); st = fs.statSync(p); } catch (_) { skipped++; continue; }
        const list = boxes(buf);
        if (!list) { skipped++; continue; }
        const meta = list.findIndex((b) => b.type === 'sfPN');
        const cs = list.findIndex((b) => b.type === 'jxlc' || b.type === 'jxlp');
        if (meta < 0 || cs < 0 || meta > cs) { already++; continue; }
        const order = [...list.filter((b) => b.type !== 'sfPN'), ...list.filter((b) => b.type === 'sfPN')];
        const out = Buffer.concat(order.map((b) => b.raw));
        if (DRY) { moved++; continue; }
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, out);
        const back = boxes(fs.readFileSync(tmp));
        const same = back && back.length === list.length
            && back.every((b, i) => b.type === order[i].type && b.raw.equals(order[i].raw));
        if (!same || out.length !== buf.length) {
            fs.unlinkSync(tmp);
            skipped++;
            console.log(`skip ${name}: readback differs`);
            continue;
        }
        fs.utimesSync(tmp, st.atimeMs / 1000, st.mtimeMs / 1000); // numbers keep the sub-millisecond part
        fs.renameSync(tmp, p);
        moved++;
        if (moved % 2000 === 0) console.log(`${moved} reordered`);
    }
    console.log(`${seen} JXL: ${moved} ${DRY ? 'to reorder' : 'reordered'}, ${already} already in order, ${skipped} skipped`);
}

main();
