'use strict';
// sessionTasks.readLines must give the same lines / offsets / end as the old implementation (a zero-filled 1 MB buffer + split + byteLength per line).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { _readLines } = require('../modules/sessionTasks');

const READ_MAX = 1024 * 1024;
function oldReadLines(file, from, skipFirst) {
    return new Promise((resolve) => {
        fs.open(file, 'r', (e, fd) => {
            if (e) { resolve({ lines: [], end: from }); return; }
            const buf = Buffer.alloc(READ_MAX);
            fs.read(fd, buf, 0, READ_MAX, from, (err, n) => {
                fs.close(fd, () => {});
                if (err || !n) { resolve({ lines: [], end: from }); return; }
                const last = buf.lastIndexOf(0x0a, n - 1);
                if (last < 0) { resolve({ lines: [], end: from }); return; }
                const lines = [];
                let off = from;
                buf.toString('utf8', 0, last + 1).split('\n').forEach((l, i) => {
                    const at = off;
                    off += Buffer.byteLength(l, 'utf8') + 1;
                    if (i === 0 && skipFirst) return;
                    if (l) lines.push({ line: l, at });
                });
                resolve({ lines, end: from + last + 1 });
            });
        });
    });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-read-'));
const file = path.join(dir, 't.jsonl');
const mk = (i) => JSON.stringify({ type: 'user', n: i, text: `line ${i} こんにちは \u{1F600} café ${'x'.repeat(i % 50)}` });
async function same(label, from, skipFirst) {
    const a = await oldReadLines(file, from, skipFirst);
    const b = await _readLines(file, from, skipFirst);
    assert.deepStrictEqual(b, a, label);
    console.log(`ok ${label}: ${b.lines.length} lines, end ${b.end}`);
    return b;
}
(async () => {
    fs.writeFileSync(file, Array.from({ length: 50 }, (_, i) => mk(i)).join('\n') + '\n');
    await same('first read, skipFirst, from mid-line (ASCII part)', 20, true);
    {   // a cut inside a multi-byte character: the old code re-encoded the broken bytes (U+FFFD, 3 bytes) and drifted; the new offsets are the true byte offsets
        const buf = fs.readFileSync(file);
        const r = await _readLines(file, 37, true);
        r.lines.forEach((l) => assert.strictEqual(buf.toString('utf8', l.at, l.at + Buffer.byteLength(l.line)), l.line));
        console.log('ok mid-multibyte cut: every offset points at its line (old code drifted by 4 bytes here)');
    }
    await same('from 0, no skip', 0, false);
    const end1 = (await same('small file full', 0, false)).end;
    fs.appendFileSync(file, mk(51) + '\n');
    await same('small append', end1, false);
    fs.appendFileSync(file, mk(52) + '\n' + mk(53).slice(0, 20));
    await same('append with partial last line', end1, false);
    fs.appendFileSync(file, '\n\n' + mk(54) + '\n');
    await same('blank lines / completed partial', end1, false);
    fs.appendFileSync(file, 'no newline at all');
    const sz = fs.statSync(file).size;
    await same('no newline since offset', sz - 5, false);
    await same('offset at EOF', sz, false);
    // > READ_MAX backlog, multi-byte lines straddling the cut
    const big = [];
    let bytes = 0;
    for (let i = 0; bytes < 2.5 * READ_MAX; i += 1) { const l = mk(i); big.push(l); bytes += Buffer.byteLength(l) + 1; }
    fs.writeFileSync(file, big.join('\n') + '\n');
    let from = 0;
    let total = 0;
    for (let pass = 0; pass < 6; pass += 1) { const r = await same(`backlog pass ${pass}`, from, false); total += r.lines.length; if (r.end <= from) break; from = r.end; }
    assert.strictEqual(total, big.length);
    await same('backlog first look (size - READ_MAX), skipFirst', fs.statSync(file).size - READ_MAX, true);

    // allocation: 1000 small-append syncs
    fs.writeFileSync(file, mk(0) + '\n');
    let off = fs.statSync(file).size;
    const bench = async (fn) => {
        const base = process.memoryUsage().arrayBuffers; let peak = 0; let sum = 0; let o = off;
        if (global.gc) global.gc();
        const t = Date.now();
        for (let i = 0; i < 1000; i += 1) { fs.appendFileSync(file, mk(i) + '\n'); const r = await fn(file, o, false); o = r.end; sum += process.memoryUsage().arrayBuffers - base; peak = Math.max(peak, process.memoryUsage().arrayBuffers - base); }
        off = o;
        return { ms: Date.now() - t, peakArrayBufferKB: Math.round(peak / 1024) };
    };
    console.log('old', JSON.stringify(await bench(oldReadLines)));
    console.log('new', JSON.stringify(await bench(_readLines)));
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('PASS');
})().catch((e) => { console.error(e); process.exit(1); });
