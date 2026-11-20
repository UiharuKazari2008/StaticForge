/**
 * Update packs (Yozora #951, Nov 20 2026): one zip per update round, for any subset of the manifest.
 *
 * Yukimi: "verify that all update clients are using ZIP-based updates with extraction and are not requesting each
 * file one by one". The installer already took one pack; every in-app round (sw.js CACHE_STATIC_FILES) asked for
 * each file on its own - 2,969 GETs in one round from a desktop on the phone's hotspot. sw.js now asks for its list
 * here (POST /install/meletonfx.zip), and so do the installer, phoneUpdate.js and the shell commit.
 *
 * Fast for any list, no pack built per request: an entry whose bytes are already in a built pack
 * (meletonInstallPack: pack.zip and the package sets' pack-<name>.zip) is copied out of it as it is - its compressed
 * bytes, CRC and sizes from the pack's central directory - and only the rest is read from disk and compressed here
 * (stored for bytes that are already compressed, STORE_EXT). The answer has a Content-Length up front and streams.
 *
 * The zip: pack.json first ({ v: 2, hash, files: [{ entry, url, hash, body, size, type }], missing: [{ url, reason }] }),
 * then one entry per file, local headers with real sizes (no data descriptors). `body` is the SHA-256 of the bytes in
 * the entry, `hash` the manifest's; `missing` names what is not in it: not-found (not in the manifest), auth (behind
 * sign-in, never in the static cache), unresolved (in the manifest, no file on disk yet).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const updateEngine = require('../public/scripts/launch/updateEngine');
const meletonInstallPack = require('./meletonInstallPack');

const deflateRaw = promisify(zlib.deflateRaw);
const inflateRaw = promisify(zlib.inflateRaw);
const STORE_EXT = meletonInstallPack.STORE_EXT;
// fresh entries: zlib's default level (level 9 costs ~3x the CPU for ~2 % on this code) on the thread pool
const FRESH_LEVEL = 6;
const FRESH_PARALLEL = 4;
const READ_CHUNK = 1024 * 1024;

function extensionOf(url) {
    const clean = String(url || '').split('?')[0];
    const dot = clean.lastIndexOf('.');
    return dot < 0 ? '' : clean.slice(dot + 1).toLowerCase();
}

function crc32(buf) {
    if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (~c) >>> 0;
}

// ---- built packs: their central directory, read once per file on disk -------------------------------------------

// zip path -> { key: 'ino:size:mtime', byUrl: Map(url -> { hash, body, method, crc, csize, usize, dataOffset }) }
const indexes = new Map();

async function readAt(fh, position, length) {
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
        const { bytesRead } = await fh.read(buf, got, length - got, position + got);
        if (!bytesRead) break;
        got += bytesRead;
    }
    return got === length ? buf : buf.subarray(0, got);
}

/** The pack's entries by url, or null (no pack, zip64, damaged). */
async function indexPack(fh, stat) {
    const tailLen = Math.min(stat.size, 65557);
    const tail = await readAt(fh, stat.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null;
    const cd = await readAt(fh, cdOffset, cdSize);
    const entries = new Map();
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
        if (cd.readUInt32LE(p) !== 0x02014b50) return null;
        const method = cd.readUInt16LE(p + 10);
        const crc = cd.readUInt32LE(p + 16);
        const csize = cd.readUInt32LE(p + 20);
        const usize = cd.readUInt32LE(p + 24);
        const fnl = cd.readUInt16LE(p + 28);
        const el = cd.readUInt16LE(p + 30);
        const cl = cd.readUInt16LE(p + 32);
        const local = cd.readUInt32LE(p + 42);
        const name = cd.toString('utf8', p + 46, p + 46 + fnl);
        if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) return null;
        entries.set(name, { method, crc, csize, usize, local });
        p += 46 + fnl + el + cl;
    }
    // where each entry's data starts: after its own local header (its name and extra field lengths)
    const list = [...entries.values()];
    for (let i = 0; i < list.length; i += 64) {
        await Promise.all(list.slice(i, i + 64).map(async (e) => {
            const head = await readAt(fh, e.local, 30);
            if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) { e.dataOffset = -1; return; }
            e.dataOffset = e.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
        }));
    }
    const meta = entries.get('pack.json');
    if (!meta || meta.dataOffset < 0) return null;
    const raw = await readAt(fh, meta.dataOffset, meta.csize);
    const listing = JSON.parse((meta.method === 8 ? await inflateRaw(raw) : raw).toString('utf8'));
    const byUrl = new Map();
    for (const row of (listing && listing.files) || []) {
        const e = row && entries.get(row.entry);
        if (!e || e.dataOffset < 0 || (e.method !== 0 && e.method !== 8)) continue;
        byUrl.set(row.url, { hash: row.hash, body: row.body || '', method: e.method, crc: e.crc, csize: e.csize, usize: e.usize, dataOffset: e.dataOffset });
    }
    return byUrl;
}

/** The built packs on disk, open, with their indexes: [{ fh, byUrl }]. The caller closes them (closePacks). */
async function openPacks() {
    const dir = meletonInstallPack.directory();
    if (!dir) return [];
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => /^pack(?:-[a-z0-9-]+)?\.zip$/i.test(f)); } catch (_) { return []; }
    // the default pack first (most clients), then the package sets', newest first
    names.sort((a, b) => (a === 'pack.zip' ? -1 : b === 'pack.zip' ? 1 : 0));
    const open = [];
    for (const name of names) {
        const file = path.join(dir, name);
        let fh = null;
        try {
            fh = await fs.promises.open(file, 'r');
            // the open file is what is read: a rebuild renames a new pack over it, this one stays readable
            const stat = await fh.stat();
            const key = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
            let idx = indexes.get(file);
            if (!idx || idx.key !== key) {
                idx = { key, byUrl: await indexPack(fh, stat) };
                indexes.set(file, idx);
            }
            if (idx.byUrl) open.push({ fh, byUrl: idx.byUrl, name });
            else await fh.close();
        } catch (_) {
            if (fh) await fh.close().catch(() => {});
        }
    }
    // indexes of packs no longer on disk
    for (const file of indexes.keys()) if (!names.includes(path.basename(file))) indexes.delete(file);
    return open;
}

function closePacks(open) {
    return Promise.all(open.map((p) => p.fh.close().catch(() => {})));
}

// ---- one answer -----------------------------------------------------------------------------------------------

function localHeader(name, method, crc, csize, usize) {
    const nameBuf = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names, sizes in this header (no data descriptor)
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(0x21, 12); // 1980-01-01
    h.writeUInt32LE(crc >>> 0, 14);
    h.writeUInt32LE(csize >>> 0, 18);
    h.writeUInt32LE(usize >>> 0, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    return Buffer.concat([h, nameBuf]);
}

function centralHeader(name, method, crc, csize, usize, offset) {
    const nameBuf = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(method, 10);
    h.writeUInt16LE(0, 12);
    h.writeUInt16LE(0x21, 14);
    h.writeUInt32LE(crc >>> 0, 16);
    h.writeUInt32LE(csize >>> 0, 20);
    h.writeUInt32LE(usize >>> 0, 24);
    h.writeUInt16LE(nameBuf.length, 28);
    // extra, comment, disk, internal and external attributes: 0
    h.writeUInt32LE(offset >>> 0, 42);
    return Buffer.concat([h, nameBuf]);
}

async function freshEntry(diskPath, entry) {
    const bytes = await fs.promises.readFile(diskPath);
    const body = crypto.createHash('sha256').update(bytes).digest('hex');
    const store = STORE_EXT.has(extensionOf(entry));
    const data = store ? bytes : await deflateRaw(bytes, { level: FRESH_LEVEL });
    return { method: store ? 0 : 8, crc: crc32(bytes), csize: data.length, usize: bytes.length, data, body };
}

/**
 * Plans the zip for these manifest rows. options: { manifestByUrl: Map, requested: [{ url }], resolveFile(row),
 * allowAuth(row) -> bool, contentType(url) }. Returns { hash, total, parts, files, missing, copied, packed, close }.
 * parts: Buffers and { fh, offset, length } ranges, in order; total: their bytes.
 */
async function plan(options) {
    const manifestByUrl = options.manifestByUrl;
    const missing = [];
    const rows = [];
    const seen = new Set();
    for (const item of options.requested || []) {
        const url = item && typeof item.url === 'string' ? item.url : '';
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const row = manifestByUrl.get(url);
        if (!row) { missing.push({ url, reason: 'not-found' }); continue; }
        rows.push(row);
    }
    // X-Pack-Hash: over the manifest rows asked for (updateEngine.copyPack compares it with the list it sent)
    const hash = meletonInstallPack.hashManifest(rows);
    const packs = await openPacks();
    const items = [];
    const entryNames = new Set();
    const fresh = [];
    for (const row of rows) {
        const auth = row.auth === true;
        if (auth && !(options.allowAuth && options.allowAuth(row))) { missing.push({ url: row.url, reason: 'auth' }); continue; }
        const entry = updateEngine.zipEntryName(row.url);
        if (entryNames.has(entry)) continue;
        entryNames.add(entry);
        let source = null;
        for (const p of packs) {
            const hit = p.byUrl.get(row.url);
            if (hit && hit.hash === row.hash) { source = { pack: p, hit }; break; }
        }
        const item = { row, entry, source, type: options.contentType ? options.contentType(row.url) : '' };
        if (!source) {
            item.diskPath = options.resolveFile ? options.resolveFile(row) : null;
            if (!item.diskPath) { entryNames.delete(entry); missing.push({ url: row.url, reason: 'unresolved' }); continue; }
            fresh.push(item);
        }
        items.push(item);
    }
    // the few files no built pack holds at this hash: read and compressed now, a few at a time on the thread pool
    for (let i = 0; i < fresh.length; i += FRESH_PARALLEL) {
        await Promise.all(fresh.slice(i, i + FRESH_PARALLEL).map(async (item) => {
            try { item.fresh = await freshEntry(item.diskPath, item.entry); } catch (_) { item.fresh = null; }
        }));
    }
    const kept = items.filter((item) => item.source || item.fresh);
    for (const item of items) if (!item.source && !item.fresh) missing.push({ url: item.row.url, reason: 'unresolved' });

    const listing = {
        v: 2,
        hash,
        files: kept.map((item) => ({
            entry: item.entry,
            url: item.row.url,
            hash: item.row.hash,
            body: item.source ? item.source.hit.body : item.fresh.body,
            size: item.source ? item.source.hit.usize : item.fresh.usize,
            type: item.type || undefined
        })),
        missing
    };
    const metaRaw = Buffer.from(JSON.stringify(listing), 'utf8');
    const metaData = await deflateRaw(metaRaw, { level: FRESH_LEVEL });
    const parts = [];
    const central = [];
    let offset = 0;
    const add = (name, method, crc, csize, usize, dataPart) => {
        const head = localHeader(name, method, crc, csize, usize);
        central.push(centralHeader(name, method, crc, csize, usize, offset));
        parts.push(head, dataPart);
        offset += head.length + csize;
    };
    add('pack.json', 8, crc32(metaRaw), metaData.length, metaRaw.length, metaData);
    for (const item of kept) {
        if (item.source) {
            const h = item.source.hit;
            add(item.entry, h.method, h.crc, h.csize, h.usize, { fh: item.source.pack.fh, offset: h.dataOffset, length: h.csize });
        } else {
            const f = item.fresh;
            add(item.entry, f.method, f.crc, f.csize, f.usize, f.data);
        }
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    parts.push(cd, end);
    const total = offset + cd.length + end.length;
    // packs no entry is read from close now
    const used = new Set(kept.filter((item) => item.source).map((item) => item.source.pack));
    await closePacks(packs.filter((p) => !used.has(p)));
    return {
        hash,
        total,
        parts,
        files: kept.length,
        missing,
        copied: kept.filter((item) => item.source).length,
        packed: kept.filter((item) => !item.source).length,
        bytes: kept.reduce((n, item) => n + (item.source ? item.source.hit.usize : item.fresh.usize), 0),
        close: () => closePacks([...used])
    };
}

/** Writes the planned zip to res (backpressure kept, stops when the client goes). Resolves true when all was sent. */
async function send(res, planned) {
    let gone = false;
    res.on('close', () => { gone = true; });
    const write = (buf) => new Promise((resolve) => {
        if (res.write(buf)) resolve();
        else res.once('drain', resolve);
    });
    try {
        for (const part of planned.parts) {
            if (gone) return false;
            if (Buffer.isBuffer(part)) {
                await write(part);
                continue;
            }
            for (let at = 0; at < part.length && !gone;) {
                const n = Math.min(READ_CHUNK, part.length - at);
                const chunk = await readAt(part.fh, part.offset + at, n);
                if (chunk.length !== n) throw new Error('pack read short');
                await write(chunk);
                at += n;
            }
        }
        if (!gone) res.end();
        return !gone;
    } finally {
        await planned.close();
    }
}

module.exports = { plan, send, indexPack, crc32 };
