#!/usr/bin/env node
'use strict';

/**
 * Brand a copy of the system Chromium as Alchemy (services/grimoire-browser). No compile.
 *
 *   node scripts/alchemy-brand-chromium.js
 *
 * Source:  $CHROMIUM_DIR (default /usr/lib/chromium)
 * Output:  $ALCHEMY_CHROMIUM_DIR (default ~/.local/share/dreamscape/alchemy-chromium), binary "alchemy"
 *
 * Files are hard-linked from the source; only the .pak files are rewritten:
 * - locales/*.pak: product name "Chromium" -> "Alchemy" (license credits keep "The Chromium Authors").
 * - chrome_100_percent.pak, chrome_200_percent.pak, resources.pak: product logos -> alchemy.png,
 *   and the flat grey logo -> alchemy-mono.svg.
 *   Logos are found by their pixels, not by resource id, because ids change between Chromium versions.
 * Re-run after every apt Chromium update. Until then the service keeps using the newer system Chromium.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sharp = require(path.join(ROOT, 'services', 'grimoire-browser', 'node_modules', 'sharp'));

const SRC = process.env.CHROMIUM_DIR || '/usr/lib/chromium';
const OUT = process.env.ALCHEMY_CHROMIUM_DIR || path.join(os.homedir(), '.local', 'share', 'dreamscape', 'alchemy-chromium');
const LOGO = path.join(ROOT, 'public', 'static_images', 'app_icons', 'alchemy.png');
const MONO_LOGO = path.join(ROOT, 'public', 'static_images', 'app_icons', 'alchemy-mono.svg');
const PRODUCT = /Chromium(?! Authors| open source|<\/a> open source| OS)/g;
const IMAGE_PAKS = ['chrome_100_percent.pak', 'chrome_200_percent.pak', 'resources.pak'];

// Chromium .pak v5: header, (id, offset) table + sentinel, alias table, data.
function readPak(file) {
    const d = fs.readFileSync(file);
    const version = d.readUInt32LE(0);
    if (version !== 5) throw new Error(file + ': unsupported pak version ' + version);
    const encoding = d.readUInt32LE(4);
    const count = d.readUInt16LE(8);
    const aliasCount = d.readUInt16LE(10);
    const table = [];
    let pos = 12;
    for (let i = 0; i <= count; i++, pos += 6) table.push([d.readUInt16LE(pos), d.readUInt32LE(pos + 2)]);
    const entries = [];
    for (let i = 0; i < count; i++) entries.push({ id: table[i][0], data: d.subarray(table[i][1], table[i + 1][1]) });
    const aliases = d.subarray(pos, pos + aliasCount * 4);
    return { encoding, entries, aliases, aliasCount };
}

function writePak(file, pak) {
    const head = 12 + (pak.entries.length + 1) * 6 + pak.aliases.length;
    const header = Buffer.alloc(head);
    header.writeUInt32LE(5, 0);
    header.writeUInt32LE(pak.encoding, 4);
    header.writeUInt16LE(pak.entries.length, 8);
    header.writeUInt16LE(pak.aliasCount, 10);
    let pos = 12;
    let offset = head;
    for (const entry of pak.entries) {
        header.writeUInt16LE(entry.id, pos);
        header.writeUInt32LE(offset, pos + 2);
        pos += 6;
        offset += entry.data.length;
    }
    header.writeUInt16LE(0, pos);
    header.writeUInt32LE(offset, pos + 2);
    pak.aliases.copy(header, pos + 6);
    fs.writeFileSync(file, Buffer.concat([header].concat(pak.entries.map((entry) => entry.data))));
}

// Entries are raw, gzip, or Chromium brotli (0x1e 0x9b + 6-byte size).
function unwrap(data) {
    if (data[0] === 0x1f && data[1] === 0x8b) return { kind: 'gzip', body: zlib.gunzipSync(data) };
    if (data[0] === 0x1e && data[1] === 0x9b) return { kind: 'brotli', body: zlib.brotliDecompressSync(data.subarray(8)) };
    return { kind: 'raw', body: data };
}

function wrap(kind, body) {
    if (kind === 'gzip') return zlib.gzipSync(body, { level: 9 });
    if (kind === 'brotli') {
        const head = Buffer.alloc(8);
        head[0] = 0x1e;
        head[1] = 0x9b;
        head.writeUIntLE(body.length, 2, 6);
        return Buffer.concat([head, zlib.brotliCompressSync(body)]);
    }
    return body;
}

function squarePng(body) {
    if (body.length < 24 || body[0] !== 0x89 || body[1] !== 0x50) return 0;
    const width = body.readUInt32BE(16);
    return width === body.readUInt32BE(20) && width >= 16 ? width : 0;
}

async function pixels(body) {
    const { data, info } = await sharp(body).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const size = info.width;
    const px = (fx, fy) => {
        const x = Math.min(size - 1, Math.round(fx * size));
        const y = Math.min(size - 1, Math.round(fy * size));
        const i = (y * size + x) * 4;
        return data.subarray(i, i + 4);
    };
    const ring = (r, test) => {
        let hits = 0;
        for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4;
            if (test(px(0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)))) hits++;
        }
        return hits;
    };
    const cornersClear = [px(0.02, 0.02), px(0.98, 0.02), px(0.02, 0.98), px(0.98, 0.98)].every((p) => p[3] < 60);
    return { px, ring, cornersClear };
}

const blue = (p) => p[3] > 200 && p[2] > 170 && p[2] > p[0] + 40;
const light = (p) => p[3] > 200 && p[0] > 140 && p[1] > 175;
const dark = (p) => p[3] > 200 && Math.abs(p[0] - p[1]) < 20 && Math.abs(p[1] - p[2]) < 20 && p[0] < 120;

// Blue centre, light ring, blue outer ring: the colour logo at sizes where the rings are crisp.
async function looksLikeColorLogo(body) {
    const { px, ring, cornersClear } = await pixels(body);
    return cornersClear && blue(px(0.5, 0.5)) && ring(0.1, blue) >= 7 && ring(0.205, light) >= 6 && ring(0.36, blue) >= 7;
}

// Dark grey centre, transparent ring, dark grey outer ring.
async function looksLikeMonoLogo(body) {
    const { px, ring, cornersClear } = await pixels(body);
    return cornersClear && dark(px(0.5, 0.5)) && ring(0.1, (p) => p[3] > 100) >= 7 && ring(0.22, (p) => p[3] < 130) >= 6 && ring(0.38, dark) >= 6;
}

const N = 24;
const thumb = (body) => sharp(body).ensureAlpha().resize(N, N, { fit: 'fill' }).raw().toBuffer();

// Every size of the colour logo is close to the largest crisp one at 24x24 (shape and colour).
async function nearReference(ref, body) {
    const s = await thumb(body);
    let mask = 0;
    let rgb = 0;
    let grey = 0;
    let opaque = 0;
    for (let i = 0; i < N * N * 4; i += 4) {
        const a1 = ref[i + 3] / 255;
        const a2 = s[i + 3] / 255;
        mask += (a1 - a2) ** 2;
        const w = Math.min(a1, a2);
        for (let c = 0; c < 3; c++) rgb += w * ((ref[i + c] - s[i + c]) / 255) ** 2;
        if (a2 > 0.5) {
            opaque++;
            if (Math.abs(s[i] - s[i + 1]) < 20 && Math.abs(s[i + 1] - s[i + 2]) < 20) grey++;
        }
    }
    return mask / (N * N) < 0.08 && rgb / (N * N) < 0.06 && (!opaque || grey / opaque < 0.3);
}

function linkTree(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const from = path.join(src, name);
        const to = path.join(dest, name);
        const stat = fs.lstatSync(from);
        if (stat.isDirectory()) linkTree(from, to);
        else if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
        else {
            try { fs.linkSync(from, to); } catch (_) { fs.copyFileSync(from, to); }
            fs.chmodSync(to, stat.mode);
        }
    }
}

function rebrandStrings(file) {
    const pak = readPak(file);
    const decoder = pak.encoding === 2 ? 'utf16le' : 'utf8';
    let changed = 0;
    for (const entry of pak.entries) {
        const text = entry.data.toString(decoder);
        if (!PRODUCT.test(text)) continue;
        PRODUCT.lastIndex = 0;
        entry.data = Buffer.from(text.replace(PRODUCT, 'Alchemy'), decoder);
        changed++;
    }
    PRODUCT.lastIndex = 0;
    fs.unlinkSync(file);
    writePak(file, pak);
    return changed;
}

async function main() {
    const binary = path.join(SRC, 'chromium');
    const versionText = String(spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000 }).stdout || '');
    const version = (versionText.match(/(\d+\.\d+\.\d+\.\d+)/) || [])[1];
    if (!version) throw new Error('cannot read the Chromium version from ' + binary);

    const work = OUT + '.tmp';
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(OUT), { recursive: true, mode: 0o700 });
    linkTree(SRC, work);
    fs.renameSync(path.join(work, 'chromium'), path.join(work, 'alchemy'));

    let strings = 0;
    for (const name of fs.readdirSync(path.join(work, 'locales'))) {
        if (name.endsWith('.pak')) strings += rebrandStrings(path.join(work, 'locales', name));
    }

    const paks = IMAGE_PAKS.map((name) => ({ name, file: path.join(work, name), pak: readPak(path.join(work, name)) }));
    const candidates = [];
    for (const item of paks) {
        for (const entry of item.pak.entries) {
            let unwrapped;
            try { unwrapped = unwrap(entry.data); } catch (_) { continue; }
            const size = squarePng(unwrapped.body);
            if (size) candidates.push({ item, entry, size, kind: unwrapped.kind, body: unwrapped.body });
        }
    }
    let reference = null;
    for (const c of candidates) {
        if ((!reference || c.size > reference.size) && await looksLikeColorLogo(c.body)) reference = c;
    }
    if (!reference) throw new Error('no Chromium logo found in the resource packs');
    const ref = await thumb(reference.body);
    const logo = fs.readFileSync(LOGO);
    const monoLogo = fs.readFileSync(MONO_LOGO);
    const replaced = [];
    for (const c of candidates) {
        const mono = await looksLikeMonoLogo(c.body);
        if (!mono && !(await nearReference(ref, c.body))) continue;
        const image = sharp(mono ? monoLogo : logo, { density: 600 }).resize(c.size, c.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
        c.entry.data = wrap(c.kind, await image.png().toBuffer());
        replaced.push(c.item.name + ':' + c.entry.id + ' ' + c.size + 'px' + (mono ? ' mono' : ''));
    }
    for (const item of paks) {
        fs.unlinkSync(item.file);
        writePak(item.file, item.pak);
    }

    fs.writeFileSync(path.join(work, 'alchemy-brand.json'), JSON.stringify({
        chromiumVersion: version,
        source: SRC,
        strings,
        logos: replaced,
        builtAt: new Date().toISOString()
    }, null, 2));

    const old = OUT + '.old';
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(OUT)) fs.renameSync(OUT, old);
    fs.renameSync(work, OUT);
    fs.rmSync(old, { recursive: true, force: true });
    console.log('Alchemy ' + version + ' -> ' + path.join(OUT, 'alchemy'));
    console.log(strings + ' strings, ' + replaced.length + ' logos: ' + replaced.join(', '));
    console.log('Restart Alchemy (pm2 restart grimoire-browser) to use it.');
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
