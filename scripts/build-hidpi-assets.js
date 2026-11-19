#!/usr/bin/env node
/**
 * HiDPI variants of the desktop's raster art (Yozora #921, DreamOS fractional scaling, #910).
 *
 * DreamOS laptops draw the desktop at 125-300 % (the MacBook's Retina panel at 200 %, Yukimi runs it at
 * 125 %), so devicePixelRatio is 1.25 / 1.5 / 1.75 / 2 and art drawn at 1x is blurry. This script makes
 * a 1.25x, 1.5x, 1.75x and 2x copy of every raster the desktop draws, at
 *
 *   public/static_images/hidpi/<125|150|175|200>/<the 1x file's path under static_images>
 *
 * plus public/static_images/hidpi/index.json (which assets have variants, their size and how each was
 * made) and public/static_images/hidpi/<tier>/img.css (the <img> overrides, below). A client downloads
 * only its own tier: the four folders are the asset packages hidpi-125 ... hidpi-200
 * (public/scripts/launch/assetPackages.js), picked from devicePixelRatio.
 *
 * Where each variant comes from, best first (the "m" field of index.json):
 *   vista       Vista's own art at that density: aero.msstyles' 120 / 192 DPI images (VISTA_ORIGINALS)
 *               or the frame of that exact size in the Vista icon group the 1x icon was cut from (found
 *               by matching its pixels against the icon groups of Vista's DLLs, --index-vista)
 *   vista-down  an exact Hermite downscale of a larger Vista frame (how Vista itself draws a 20 px icon
 *               at 120 DPI from the 32 px frame; explorer-tree note: Hermite matches the VM to 0.5 %)
 *   sibling     a larger copy of the same art already in the tree (foo-32.png for foo-16.png, foo@2x.png),
 *               used as it is when it has the target size, else Hermite-downscaled
 *   slice9      nine-slice (border-image) art: each of the nine pieces is scaled on its own, so the slice
 *               geometry stays exact at every tier (slices from the CSS that uses it)
 *   pixel       hard-edged art (few colours, alpha only 0 / 255: glyphs, cursors' masks, 1-bit art):
 *               nearest-neighbour at 2x; at 1.25 / 1.5 / 1.75 nearest to 2x, then an area downscale
 *               ("sharp bilinear": even strokes, no new detail)
 *   ai          large soft / photographic art: the local Ruiko upscaler (RealESRGAN, free) at 4x, then a
 *               Lanczos downscale to each tier
 *   soft        everything else: Catmull-Rom upscale
 * The upscalers never add detail beyond resampling except 'ai', which runs only on photographic art.
 *
 * Delivery (the client side):
 *   CSS         --css rewrites every url(/static_images/...) that has variants in public/css into
 *               image-set(url(1x) 1x, url(hidpi/125/..) 1.25x, ...): the browser fetches only the density it
 *               draws and switches live when the scale changes; border-image-slice stays in CSS px
 *               (Chromium maps it through the image-set density, checked).
 *   <img>       hidpi/<tier>/img.css: img[src="<1x path>"] { content: image-set(url(<variant>) <density>x) }.
 *               Same layout (natural size unchanged), no script per image; assetPackages.js links the
 *               client's tier's sheet and swaps it when the scale changes.
 *
 * Incremental: every variant is cached in ~/.cache/hidpi-assets/v/<key>/ keyed by the hash of its sources
 * and method, and an output file is only rewritten when its bytes change, so a rerun after new art lands
 * redoes only that art (run it after any art change; --css afterwards picks up new references).
 *
 * Usage:
 *   node scripts/build-hidpi-assets.js --index-vista <dir>   index the icon groups of Vista PE files
 *                                                            (<dir>/<file>/.rsrc/{GROUP_ICON,ICON} from 7z)
 *   node scripts/build-hidpi-assets.js --list [--only <re>]  the plan: method per asset, counts
 *   node scripts/build-hidpi-assets.js [--out <dir>] [--only <re>] [--no-ai] [--jobs N]
 *                                                            build the variants, index.json, img.css
 *   node scripts/build-hidpi-assets.js --css [--write]       the stylesheet rewrite (dry run without --write;
 *                                                            files with uncommitted edits are skipped unless
 *                                                            --include-dirty)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SI = path.join(PUB, 'static_images');
const CACHE = path.join(os.homedir(), '.cache/hidpi-assets');
const VERSION = 3; // bump when a method changes its output
const TIERS = [
    { id: 125, s: 1.25 },
    { id: 150, s: 1.5 },
    { id: 175, s: 1.75 },
    { id: 200, s: 2 }
];
const WEB_HIDPI = '/static_images/hidpi';

// the desktop's art; the phone's (wm61, wm65, wm-android) has its own @2x / @4x packages, the Vista
// games their own HiDPI build (build-vista-games-hidpi.sh), gadget packages draw in their own frames
const INCLUDE = /^(?:vista-(?!gadgets\/|games\/)[a-z0-9-]+|window-controls|activesync|account-pictures|melaton|cpu|xyridian)\//;
const EXCLUDE = /(?:^|\/)originals\/|@\d(?:\.\d+)?x\.[a-z]+$/i;
const RASTER = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const MAX_AREA = 600000; // bigger art is shown scaled down already (logos, marks, sources)
const MAX_SIDE = 256; // art at least this big both ways (256 px icon frames, logos): Vista has nothing larger
// and an upscale adds bytes, not sharpness

// Vista's own art at other densities. aero.msstyles (PREMULTIPLIED) holds 96 / 120 / 192 DPI copies of a
// few parts; the cells are re-gridded to round(cell x scale) so CSS background positions keep stepping.
const AERO = path.join(os.homedir(), '.cache/vista-vm/aero');
const VISTA_ORIGINALS = {
    'vista-controls/checkbox.png': { cell: [13, 13], frames: { 120: 'IMAGE_509.png', 192: 'IMAGE_510.png' } },
    'vista-controls/radio.png': { cell: [13, 13], frames: { 120: 'IMAGE_517.png', 192: 'IMAGE_518.png' } }
};

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = path.resolve(opt('--out', path.join(SI, 'hidpi')));
const ONLY = opt('--only') ? new RegExp(opt('--only')) : null;
const JOBS = Number(opt('--jobs', Math.max(2, Math.min(8, os.cpus().length))));

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const mkdirp = (d) => fs.mkdirSync(d, { recursive: true });

function magick(argv) {
    return new Promise((resolve, reject) => {
        execFile('magick', argv, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => (err ? reject(new Error(`magick ${argv.join(' ')}: ${stderr || err.message}`)) : resolve(stdout)));
    });
}

async function pool(items, n, fn) {
    let i = 0;
    const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

// ---------------------------------------------------------------- the assets
function walk(dir, rel, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
            if (r === 'hidpi') continue;
            walk(path.join(dir, e.name), r, out);
        } else if (RASTER.test(e.name) && INCLUDE.test(r) && !EXCLUDE.test(r)) out.push(r);
    }
    return out;
}

async function meta(rel) {
    const m = await sharp(path.join(SI, rel), { animated: true }).metadata();
    return { w: m.width, h: m.pageHeight || m.height, pages: m.pages || 1, format: m.format, alpha: !!m.hasAlpha };
}

async function rgba(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
}

// hard-edged art: alpha only 0 / 255 and few colours
function analyse(px) {
    const colours = new Set();
    let softAlpha = 0; let opaque = 0;
    for (let i = 0; i < px.data.length; i += 4) {
        const a = px.data[i + 3];
        if (a !== 0 && a !== 255) softAlpha++;
        if (a === 255) opaque++;
        if (a) colours.add((px.data[i] << 16) | (px.data[i + 1] << 8) | px.data[i + 2]);
        if (colours.size > 5000) break;
    }
    const n = px.w * px.h;
    return { colours: colours.size, softAlpha: softAlpha / n, opaque: opaque / n };
}

// ---------------------------------------------------------------- CSS: nine-slices and references
function cssFiles() {
    const out = [];
    const rec = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) rec(p);
            else if (e.name.endsWith('.css') && !e.name.endsWith('.min.css')) out.push(p);
        }
    };
    rec(path.join(PUB, 'css'));
    return out;
}

// border-image slices per asset: 'border-image: url(x) 4 3 4 3 fill ...' or border-image-source + -slice
function nineSlices() {
    const map = new Map();
    for (const f of cssFiles()) {
        const css = fs.readFileSync(f, 'utf8');
        const re = /border-image(?:-source)?\s*:\s*([^;}]*)/g;
        let m;
        while ((m = re.exec(css))) {
            const urls = [...m[1].matchAll(/url\(\s*['"]?\/static_images\/([^'")\s]+)['"]?\s*\)/g)].map((u) => u[1]);
            if (!urls.length) continue;
            let sliceText = m[1].replace(/image-set\([^;]*?\)\s*\)|url\([^)]*\)/g, ' ');
            if (/border-image-source/.test(css.slice(m.index, m.index + 20))) {
                // the slice is in the same rule
                const end = css.indexOf('}', m.index);
                const s = /border-image-slice\s*:\s*([^;}]*)/.exec(css.slice(m.index, end));
                sliceText = s ? s[1] : '';
            }
            const nums = (sliceText.split('/')[0].match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$|fill)/g) || []).map(Number).slice(0, 4);
            if (!nums.length) continue;
            const [t, r = t, b = t, l = r] = nums;
            for (const u of urls) if (!map.has(u)) map.set(u, { t, r, b, l });
        }
    }
    return map;
}

// ---------------------------------------------------------------- Vista icon groups
const VISTA_INDEX = path.join(CACHE, 'vista-icons');

function dibToRgba(buf) {
    const hs = buf.readUInt32LE(0);
    const w = buf.readInt32LE(4); const h2 = buf.readInt32LE(8); const bpp = buf.readUInt16LE(14);
    if (bpp !== 32) return null;
    const h = Math.abs(h2) / 2;
    const out = Buffer.alloc(w * h * 4);
    const stride = w * 4;
    for (let y = 0; y < h; y++) {
        const src = hs + (h - 1 - y) * stride;
        for (let x = 0; x < w; x++) {
            const s = src + x * 4; const d = (y * w + x) * 4;
            out[d] = buf[s + 2]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s]; out[d + 3] = buf[s + 3];
        }
    }
    return { data: out, w, h };
}

async function indexVista(dir) {
    mkdirp(VISTA_INDEX);
    const groups = [];
    for (const file of fs.readdirSync(dir)) {
        const rs = path.join(dir, file, '.rsrc');
        const gdir = path.join(rs, 'GROUP_ICON');
        if (!fs.existsSync(gdir)) continue;
        for (const gid of fs.readdirSync(gdir)) {
            const g = fs.readFileSync(path.join(gdir, gid));
            const n = g.readUInt16LE(4);
            const frames = {};
            for (let i = 0; i < n; i++) {
                const o = 6 + i * 14;
                const bpp = g.readUInt16LE(o + 6); const nid = g.readUInt16LE(o + 12);
                if (bpp !== 32) continue;
                let f = path.join(rs, 'ICON', `${nid}.ico`);
                if (!fs.existsSync(f)) f = path.join(rs, 'ICON', String(nid));
                if (!fs.existsSync(f)) continue;
                let data = fs.readFileSync(f);
                if (data.readUInt32LE(0) === 0x00010000) data = data.subarray(22);
                let px = null;
                try {
                    if (data.readUInt32LE(0) === 0x474e5089) px = await rgba(data);
                    else px = dibToRgba(data);
                } catch (_) { px = null; }
                if (!px || px.w !== px.h) continue;
                const name = `${file}_${gid.replace(/\W/g, '')}_${px.w}.png`;
                await sharp(px.data, { raw: { width: px.w, height: px.h, channels: 4 } }).png().toFile(path.join(VISTA_INDEX, name));
                frames[px.w] = name;
            }
            if (Object.keys(frames).length) groups.push({ file, gid, frames });
        }
    }
    fs.writeFileSync(path.join(VISTA_INDEX, 'index.json'), JSON.stringify(groups));
    console.log(`indexed ${groups.length} icon groups`);
}

let vistaBySize = null;
async function vistaFrames(size) {
    if (!vistaBySize) {
        vistaBySize = new Map();
        const f = path.join(VISTA_INDEX, 'index.json');
        vistaBySize.groups = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
    }
    if (!vistaBySize.has(size)) {
        const list = [];
        for (const g of vistaBySize.groups) {
            if (!g.frames[size]) continue;
            const px = await rgba(path.join(VISTA_INDEX, g.frames[size]));
            list.push({ g, px });
        }
        vistaBySize.set(size, list);
    }
    return vistaBySize.get(size);
}

// mean difference of premultiplied RGBA (0-255)
function diff(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) {
        const aa = a[i + 3] / 255; const ba = b[i + 3] / 255;
        sum += Math.abs(a[i] * aa - b[i] * ba) + Math.abs(a[i + 1] * aa - b[i + 1] * ba) + Math.abs(a[i + 2] * aa - b[i + 2] * ba) + Math.abs(a[i + 3] - b[i + 3]);
    }
    return sum / (a.length);
}

async function matchVista(px) {
    if (px.w !== px.h || px.w > 64) return null;
    let best = null;
    for (const c of await vistaFrames(px.w)) {
        const d = diff(px.data, c.px.data);
        if (!best || d < best.d) best = { d, g: c.g };
        if (d === 0) break;
    }
    // an icon extracted at its own size is the frame; a little drift (a rescaled /icon export) still counts
    if (process.env.HIDPI_DEBUG && best) console.error(`match ${px.w} d=${best.d.toFixed(2)} ${best.g.file}#${best.g.gid}`);
    return best && best.d < 1.5 ? best : null;
}

// ---------------------------------------------------------------- siblings in the tree
function siblings(rel, m) {
    const dir = path.dirname(rel);
    const base = path.basename(rel);
    const out = [];
    const abs = path.join(SI, dir);
    // foo@2x.png next to foo.png
    const ext = path.extname(base);
    const stem = base.slice(0, -ext.length);
    for (const [suf, k] of [['@2x', 2], ['@4x', 4], ['@3x', 3]]) {
        const p = path.join(abs, `${stem}${suf}${ext}`);
        if (fs.existsSync(p)) out.push({ rel: path.join(dir, `${stem}${suf}${ext}`), k });
    }
    // foo-16.png -> foo-32.png, foo-48.png ... (same art at a larger size: a whole multiple of the
    // dimensions, so atlases of icons qualify too)
    const mm = /^(.*?[-_])(\d+)(\.[a-z]+)$/i.exec(base);
    if (mm) {
        const n = Number(mm[2]);
        let names = [];
        try { names = fs.readdirSync(abs); } catch (_) { names = []; }
        for (const name of names) {
            const s = new RegExp(`^${mm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\.(?:png|webp)$`, 'i').exec(name);
            if (!s || Number(s[1]) <= n) continue;
            out.push({ rel: path.join(dir, name), k: Number(s[1]) / n });
        }
    }
    return out.filter((s) => {
        try {
            const d = execFileSync('magick', ['identify', '-format', '%w %h\n', path.join(SI, s.rel)]).toString().split('\n')[0].split(' ').map(Number);
            return Math.abs(d[0] - m.w * s.k) < 0.5 && Math.abs(d[1] - m.h * s.k) < 0.5;
        } catch (_) { return false; }
    }).sort((a, b) => a.k - b.k);
}

// ---------------------------------------------------------------- planning
async function planOne(rel, slices) {
    const m = await meta(rel);
    if (m.pages > 1) return { rel, skip: 'animated' };
    if (m.w * m.h > MAX_AREA || Math.min(m.w, m.h) >= MAX_SIDE) return { rel, skip: 'large' };
    const plan = { rel, w: m.w, h: m.h, format: m.format, sources: [] };
    const ext = path.extname(rel).toLowerCase();
    plan.outExt = ext === '.gif' || ext === '.bmp' ? '.png' : ext;
    if (VISTA_ORIGINALS[rel]) { plan.method = 'vista'; plan.vo = VISTA_ORIGINALS[rel]; return plan; }
    const sl = slices.get(rel);
    if (sl) plan.slices = sl;
    const sib = siblings(rel, m);
    if (sib.length) { plan.method = 'sibling'; plan.sib = sib; return plan; }
    const px = await rgba(path.join(SI, rel));
    const a = analyse(px);
    if (!sl) {
        const v = await matchVista(px);
        if (v) {
            const sizes = Object.keys(v.g.frames).map(Number).filter((s) => s > m.w);
            if (sizes.length) { plan.method = 'vista'; plan.icon = v.g; plan.iconDiff = v.d; return plan; }
        }
    }
    if (a.softAlpha === 0 && a.colours <= 64) plan.method = 'pixel';
    else if (!sl && m.w >= 96 && m.h >= 96 && a.opaque > 0.97 && a.colours > 4000) plan.method = 'ai';
    else plan.method = 'soft';
    if (sl) plan.method = `slice9-${plan.method}`;
    return plan;
}

// ---------------------------------------------------------------- building
const FILTER = { soft: ['-filter', 'Catrom'], down: ['-filter', 'Hermite'], lanczos: ['-filter', 'Lanczos'] };

function outArgs(file) {
    if (/\.jpe?g$/i.test(file)) return ['-quality', '92', file];
    if (/\.webp$/i.test(file)) return ['-quality', '92', '-define', 'webp:alpha-quality=100', file];
    return ['-define', 'png:compression-level=9', '-define', 'png:exclude-chunks=date,time', `PNG32:${file}`];
}

async function resize(src, w, h, how, out) {
    if (how === 'point') return magick([src, '-filter', 'Point', '-resize', `${w}x${h}!`, ...outArgs(out)]);
    if (how === 'sharp-bilinear') {
        // nearest to the next whole multiple, then an area-weighted downscale
        return magick([src, '-filter', 'Point', '-resize', '200%', '-filter', 'Triangle', '-resize', `${w}x${h}!`, ...outArgs(out)]);
    }
    return magick([src, ...(FILTER[how] || FILTER.soft), '-resize', `${w}x${h}!`, ...outArgs(out)]);
}

// nine pieces scaled each on its own
async function slice9(src, srcW, srcH, k, sl, w, h, how, out, tmp) {
    const L = Math.round(sl.l * k); const R = Math.round(sl.r * k); const T = Math.round(sl.t * k); const B = Math.round(sl.b * k);
    // target slice widths from the tier's scale
    const s = w / (srcW / k);
    const tL = Math.round(sl.l * s); const tR = Math.round(sl.r * s); const tT = Math.round(sl.t * s); const tB = Math.round(sl.b * s);
    const cols = [[0, L, tL], [L, srcW - L - R, w - tL - tR], [srcW - R, R, tR]];
    const rows = [[0, T, tT], [T, srcH - T - B, h - tT - tB], [srcH - B, B, tB]];
    const parts = [];
    for (const [y, sh, th] of rows) {
        const rowParts = [];
        for (const [x, sw, tw] of cols) {
            if (tw <= 0 || th <= 0) continue;
            const p = path.join(tmp, `p${parts.length}_${rowParts.length}.png`);
            if (sw <= 0 || sh <= 0) await magick(['-size', `${tw}x${th}`, 'xc:none', `PNG32:${p}`]);
            else await resize(`${src}[${sw}x${sh}+${x}+${y}]`, tw, th, how, p);
            rowParts.push(p);
        }
        if (!rowParts.length) continue;
        const rp = path.join(tmp, `row${parts.length}.png`);
        await magick([...rowParts, '+append', `PNG32:${rp}`]);
        parts.push(rp);
    }
    await magick([...parts, '-append', ...outArgs(out)]);
}

async function unpremultiplied(file, tmp) {
    const out = path.join(tmp, `u_${path.basename(file)}`);
    await magick([file, '-channel', 'RGB', '-fx', 'a==0?0:min(1,u/a)', '+channel', `PNG32:${out}`]);
    return out;
}

// RealESRGAN on Ruiko (modules/localUpscaleWorker.js's worker API; free, no Anlas)
let workerCfg;
function localWorker() {
    if (workerCfg !== undefined) return workerCfg;
    try {
        const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'secure.config.json'), 'utf8'));
        const list = (Array.isArray(c.localWorkers) ? c.localWorkers : [c.localWorker]).filter((w) => w && w.url && w.key);
        workerCfg = list.find((w) => w.id === 'ruiko') || list[0] || null;
    } catch (_) { workerCfg = null; }
    return workerCfg;
}
async function aiUpscale(file) {
    const w = localWorker();
    if (!w || flag('--no-ai')) throw new Error('no local worker');
    const auth = { Authorization: `Bearer ${w.key}` };
    const r = await fetch(`${w.url}/jobs`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ image: fs.readFileSync(file).toString('base64'), model: 'RealESRGAN_x4plus', scale: 4 }), signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    if (!j.job_id) throw new Error(`worker: ${JSON.stringify(j)}`);
    const until = Date.now() + 10 * 60000;
    while (Date.now() < until) {
        await new Promise((res) => setTimeout(res, 700));
        const s = await (await fetch(`${w.url}/jobs/${j.job_id}`, { headers: auth, signal: AbortSignal.timeout(10000) })).json();
        if (s.status === 'completed') break;
        if (s.status === 'failed') throw new Error(`worker job failed: ${s.error}`);
    }
    const res = await fetch(`${w.url}/jobs/${j.job_id}/result`, { headers: { ...auth, Accept: 'image/png' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`worker result ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

function tierDims(p, t) {
    if (p.vo) return { w: Math.round(p.vo.cell[0] * t.s) * (p.w / p.vo.cell[0]), h: Math.round(p.vo.cell[1] * t.s) * (p.h / p.vo.cell[1]) };
    return { w: Math.max(1, Math.round(p.w * t.s)), h: Math.max(1, Math.round(p.h * t.s)) };
}

async function buildOne(p) {
    const srcFile = path.join(SI, p.rel);
    const dir = cacheDirOf(p);
    const done = path.join(dir, 'done.json');
    if (fs.existsSync(done)) return JSON.parse(fs.readFileSync(done, 'utf8'));
    const tmp = fs.mkdtempSync(path.join(CACHE, 'tmp-'));
    mkdirp(dir);
    const how = p.method.replace(/^slice9-/, '');
    const record = { m: p.method, t: {} };
    try {
        let aiFile = null;
        if (how === 'ai') {
            try {
                aiFile = path.join(tmp, 'ai.png');
                fs.writeFileSync(aiFile, await aiUpscale(srcFile));
            } catch (err) {
                console.warn(`  ${p.rel}: ai unavailable (${err.message}), soft`);
                aiFile = null; record.m = 'soft';
            }
        }
        for (const t of TIERS) {
            const { w, h } = tierDims(p, t);
            const out = path.join(dir, `${t.id}${p.outExt}`);
            let used = record.m;
            if (p.vo) {
                // Vista's 120 DPI copy at 1.25, its 192 DPI copy at 2x (cells padded), downscaled between
                const want = t.s;
                const k = want <= 1.25 ? 120 : 192;
                const f = await unpremultiplied(path.join(AERO, p.vo.frames[k]), tmp);
                const fm = await sharp(f).metadata();
                const n = p.h / p.vo.cell[1];
                const scw = fm.width; const sch = fm.height / n;
                const cw = w; const ch = h / n;
                const cells = [];
                for (let i = 0; i < n; i++) {
                    const c = path.join(tmp, `c${i}.png`);
                    if (scw <= cw && sch <= ch) {
                        await magick([`${f}[${scw}x${sch}+0+${i * sch}]`, '-background', 'none', '-gravity', 'northwest', '-extent', `${cw}x${ch}`, `PNG32:${c}`]);
                        used = 'vista';
                    } else {
                        await resize(`${f}[${scw}x${sch}+0+${i * sch}]`, cw, ch, 'down', c);
                        used = 'vista-down';
                    }
                    cells.push(c);
                }
                await magick([...cells, '-append', ...outArgs(out)]);
            } else if (p.icon) {
                const sizes = Object.keys(p.icon.frames).map(Number).sort((a, b) => a - b);
                const exact = sizes.find((s) => s === w);
                const bigger = sizes.find((s) => s > w);
                const src = path.join(VISTA_INDEX, p.icon.frames[exact || bigger || sizes[sizes.length - 1]]);
                if (exact) { await magick([src, ...outArgs(out)]); used = 'vista'; }
                else if (bigger) { await resize(src, w, h, 'down', out); used = 'vista-down'; }
                else { await resize(src, w, h, 'soft', out); used = 'soft'; }
            } else if (p.sib) {
                const s = p.sib.find((x) => Math.abs(x.k - t.s) < 1e-6) || p.sib.find((x) => x.k > t.s) || p.sib[p.sib.length - 1];
                const sf = path.join(SI, s.rel);
                if (p.slices) await slice9(sf, p.w * s.k, p.h * s.k, s.k, p.slices, w, h, s.k >= t.s ? 'down' : 'soft', out, tmp);
                else if (Math.abs(s.k - t.s) < 1e-6) await magick([sf, ...outArgs(out)]);
                else await resize(sf, w, h, s.k > t.s ? 'down' : 'soft', out);
                used = 'sibling';
            } else {
                const mode = how === 'pixel' ? (t.s === 2 ? 'point' : 'sharp-bilinear') : how === 'ai' && aiFile ? 'lanczos' : 'soft';
                const src = how === 'ai' && aiFile ? aiFile : srcFile;
                if (p.slices) await slice9(src, aiFile && how === 'ai' ? p.w * 4 : p.w, aiFile && how === 'ai' ? p.h * 4 : p.h, aiFile && how === 'ai' ? 4 : 1, p.slices, w, h, mode, out, tmp);
                else await resize(src, w, h, mode, out);
            }
            const om = await sharp(out).metadata();
            record.t[t.id] = { w: om.width, h: om.height, m: used };
        }
        fs.writeFileSync(done, JSON.stringify(record));
        return record;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function writeIfChanged(file, bytes) {
    try { if (fs.readFileSync(file).equals(bytes)) return false; } catch (_) { /* new */ }
    mkdirp(path.dirname(file));
    fs.writeFileSync(file, bytes);
    return true;
}

// the density a variant declares: the tier's scale, or the variant's exact ratio where the size had to be
// rounded (so the natural size, and so the layout and sprite steps, stay the 1x art's)
function density(entry, t) {
    const v = entry.t[t.id];
    if (!v) return null;
    // a nine-slice stretches: its density is the tier's, so the slices land on the scaled pieces
    if (/^slice9/.test(entry.m)) return t.s;
    const exact = v.w / entry.w;
    return Math.abs(exact - t.s) < 0.02 ? t.s : Number(exact.toFixed(4));
}

function variantUrl(rel, ext, tier) {
    return `${WEB_HIDPI}/${tier}/${rel.replace(/\.[a-z]+$/i, ext)}`;
}

async function build() {
    const slices = nineSlices();
    const all = walk(SI, '', []).filter((r) => !ONLY || ONLY.test(r)).sort();
    const plans = [];
    await pool(all, JOBS, async (rel) => { plans.push(await planOne(rel, slices)); });
    plans.sort((a, b) => (a.rel < b.rel ? -1 : 1));
    const counts = {};
    for (const p of plans) { const k = p.skip ? `skip:${p.skip}` : p.method; counts[k] = (counts[k] || 0) + 1; }
    if (flag('--list')) {
        for (const p of plans) console.log(`${(p.skip ? `skip:${p.skip}` : p.method).padEnd(18)} ${p.rel}${p.w ? ` ${p.w}x${p.h}` : ''}${p.icon ? ` <- ${p.icon.file}#${p.icon.gid} d=${p.iconDiff.toFixed(2)}` : ''}${p.sib ? ` <- ${p.sib.map((s) => s.rel).join(', ')}` : ''}${p.slices ? ` slices ${p.slices.t},${p.slices.r},${p.slices.b},${p.slices.l}` : ''}`);
        console.log(counts);
        return;
    }
    const indexFile = path.join(OUT, 'index.json');
    let index = { v: 1, tiers: TIERS.map((t) => t.id), a: {} };
    if (ONLY) { try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch (_) { /* fresh */ } }
    const work = plans.filter((p) => !p.skip);
    let written = 0; let n = 0;
    const methods = {};
    await pool(work, JOBS, async (p) => {
        let rec;
        try { rec = await buildOne(p); } catch (err) { console.warn(`  ${p.rel}: ${err.message.split('\n')[0]}`); return; }
        const entry = { w: p.w, h: p.h, x: p.outExt === path.extname(p.rel).toLowerCase() ? undefined : p.outExt, m: rec.m, t: {} };
        for (const t of TIERS) {
            const v = rec.t[t.id];
            entry.t[t.id] = { w: v.w, h: v.h };
            methods[v.m] = (methods[v.m] || 0) + 1;
        }
        index.a[p.rel] = entry;
        if (++n % 200 === 0) console.log(`  ${n}/${work.length}`);
        p.rec = rec;
    });
    // copy the cached variants out
    const sizes = Object.fromEntries(TIERS.map((t) => [t.id, 0]));
    for (const p of work) {
        if (!p.rec) continue;
        const k = cacheDirOf(p);
        for (const t of TIERS) {
            const bytes = fs.readFileSync(path.join(k, `${t.id}${p.outExt}`));
            sizes[t.id] += bytes.length;
            if (writeIfChanged(path.join(OUT, String(t.id), p.rel.replace(/\.[a-z]+$/i, p.outExt)), bytes)) written++;
        }
    }
    // the <img> overrides, one sheet per tier
    for (const t of TIERS) {
        const lines = [`/* generated by scripts/build-hidpi-assets.js (Yozora #921): <img> art at ${t.s}x */`];
        for (const [rel, e] of Object.entries(index.a).sort()) {
            const d = density(e, t);
            if (!d) continue;
            lines.push(`img[src="/static_images/${rel}"]{content:image-set(url(${variantUrl(rel, e.x || path.extname(rel), t.id)}) ${d}x)}`);
        }
        const css = Buffer.from(`${lines.join('\n')}\n`);
        sizes[t.id] += css.length;
        writeIfChanged(path.join(OUT, String(t.id), 'img.css'), css);
    }
    writeIfChanged(indexFile, Buffer.from(`${JSON.stringify(index)}\n`));
    writeBgSheets(index);
    console.log({ plans: counts, variants: methods, written, bytesPerTier: Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, `${(v / 1048576).toFixed(1)} MB`])) });
}

const cacheKeys = new Map();
function cacheDirOf(p) {
    if (cacheKeys.has(p.rel)) return cacheKeys.get(p.rel);
    const srcBytes = fs.readFileSync(path.join(SI, p.rel));
    const extra = [];
    if (p.sib) p.sib.forEach((s) => extra.push(fs.readFileSync(path.join(SI, s.rel))));
    if (p.icon) Object.values(p.icon.frames).forEach((f) => extra.push(fs.readFileSync(path.join(VISTA_INDEX, f))));
    if (p.vo) Object.values(p.vo.frames).forEach((f) => extra.push(fs.readFileSync(path.join(AERO, f))));
    const key = sha(Buffer.concat([Buffer.from(`${VERSION}|${p.method}|${JSON.stringify(p.slices || null)}|${JSON.stringify(p.vo || null)}|`), srcBytes, ...extra]));
    const dir = path.join(CACHE, 'v', key.slice(0, 2), key);
    cacheKeys.set(p.rel, dir);
    return dir;
}

// ---------------------------------------------------------------- page-scale backgrounds (bg.css)
// The Android app's desktop scales in the page (app.html melatonPageScale, #934), not through the display:
// devicePixelRatio stays the screen's, so image-set() and resolution queries keep picking 1x there. When the
// page's own scale needs a higher tier than the screen does, assetPackages.js sets html[data-hidpi-tier] and
// links hidpi/<tier>/bg.css: every rule of the stylesheets that draws HiDPI art through image-set(), again,
// with that tier's copy as the only candidate (same density, so sizes and border-image slices hold).
// Specificity is unchanged (:where()), and in each stylesheet the rules that put other art or none on the
// same elements (sharing a class or id with an art rule) are repeated too, so their order still wins.
const ART_PROPS = /^(?:background|background-image|border-image|border-image-source|list-style|list-style-image|content|mask|mask-image|-webkit-mask|-webkit-mask-image|cursor)$/;
const OUR_SET = /image-set\(url\((['"]?)\/static_images\/([^'")\s]+)\1\) 1x(?:, url\(\1\/static_images\/hidpi\/[^)]*\) [\d.]+x)+\)/g;

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')); }

// rules in document order with their at-rule wrappers: { wrap: ['@media ...'], sel, body }
function cssRules(css) {
    const out = [];
    const walk = (text, wrap) => {
        let i = 0;
        while (i < text.length) {
            const open = text.indexOf('{', i);
            if (open < 0) break;
            const head = text.slice(i, open).trim().replace(/^[;}\s]+/, '');
            let depth = 1; let j = open + 1; let q = null;
            for (; j < text.length && depth; j++) {
                const ch = text[j];
                if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue; }
                if (ch === '"' || ch === "'") q = ch;
                else if (ch === '{') depth++;
                else if (ch === '}') depth--;
            }
            const body = text.slice(open + 1, j - 1);
            if (/^@(?:media|supports|container|layer)\b/i.test(head)) walk(body, [...wrap, head]);
            else if (!head.startsWith('@') && !/[{}]/.test(body)) out.push({ wrap, sel: head, body });
            i = j;
        }
    };
    walk(stripComments(css), []);
    return out;
}

function decls(body) {
    const out = [];
    let depth = 0; let q = null; let start = 0;
    for (let i = 0; i <= body.length; i++) {
        const ch = body[i];
        if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if ((ch === ';' && depth === 0) || i === body.length) {
            const d = body.slice(start, i);
            const k = d.indexOf(':');
            if (k > 0) out.push({ prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim() });
            start = i + 1;
        }
    }
    return out;
}

function splitTop(value, sep) {
    const out = []; let depth = 0; let q = null; let start = 0;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === sep && depth === 0) { out.push(value.slice(start, i)); start = i + 1; }
    }
    out.push(value.slice(start));
    return out.map((x) => x.trim());
}

// the image of one background / mask layer, or none
function layerImage(layer) {
    const m = /(?:-webkit-)?image-set\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|url\([^)]*\)|(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/.exec(layer);
    if (m) return m[0];
    // a layer whose picture comes from a custom property (desktop-boot.css --vista-logon-bg)
    const vars = layer.match(/var\(--[\w-]+(?:,[^()]*)?\)/g) || [];
    return vars.find((v) => /bg|image|img|art|face|icon|picture/i.test(v)) || vars[0] || 'none';
}

function tierSelector(sel, tier) {
    const attr = `[data-hidpi-tier="${tier}"]`;
    return splitTop(sel, ',').map((part) => {
        const m = /^(html|:root)((?:[.#[:][^\s>+~]*)?)(.*)$/i.exec(part);
        if (m) return `${m[1]}${m[2]}:where(${attr})${m[3]}`;
        return `:where(html${attr}) ${part}`;
    }).join(', ');
}

function bgSheet(index, tier) {
    const t = TIERS.find((x) => x.id === tier);
    const single = (all, q, rel) => {
        const e = index.a[rel];
        const d = e && density(e, t);
        return d ? `image-set(url(${q}${variantUrl(rel, e.x || path.extname(rel), t.id)}${q}) ${d}x)` : all;
    };
    const blocks = [];
    let rules = 0;
    for (const f of cssFiles()) {
        const css = fs.readFileSync(f, 'utf8');
        if (!css.includes('/static_images/hidpi/')) continue;
        const list = cssRules(css);
        const tokens = new Set();
        for (const r of list) if (/\/static_images\/hidpi\//.test(r.body)) (r.sel.match(/[.#][\w-]+/g) || []).forEach((x) => tokens.add(x));
        const lines = [];
        for (const r of list) {
            const art = /\/static_images\/hidpi\//.test(r.body);
            if (!art && !(r.sel.match(/[.#][\w-]+/g) || []).some((x) => tokens.has(x))) continue;
            const out = [];
            for (const { prop, value } of decls(r.body)) {
                const custom = prop.startsWith('--');
                if (!ART_PROPS.test(prop) && !(custom && value.includes('/static_images/hidpi/'))) continue;
                const imp = /!important\s*$/i.test(value) ? ' !important' : '';
                const v = value.replace(/!important\s*$/i, '').trim();
                const has = v.includes('/static_images/hidpi/');
                if (!art && /^(?:content|cursor|list-style|list-style-image)$/.test(prop)) continue;
                let p = prop; let nv = v;
                // a value built from custom properties cannot be split here; the properties themselves are
                // repeated (art in a custom property is, with the tier's copy)
                if (!custom && v.includes('var(') && !has) continue;
                if (custom) { /* as it is, the art swapped below */ } else if (prop === 'background' || prop === 'mask' || prop === '-webkit-mask') {
                    p = prop === 'background' ? 'background-image' : `${prop}-image`;
                    nv = splitTop(v, ',').map(layerImage).join(', ');
                } else if (prop === 'border-image') {
                    p = 'border-image-source';
                    nv = layerImage(v);
                } else if (prop === 'list-style') {
                    p = 'list-style-image';
                    nv = layerImage(v);
                }
                if (!has && !art && /^(?:inherit|initial|unset|revert|var\()/.test(nv)) continue;
                nv = nv.replace(OUR_SET, single);
                out.push(`${p}:${nv}${imp}`);
            }
            if (!out.length) continue;
            let rule = `${tierSelector(r.sel, tier)}{${out.join(';')}}`;
            for (const w of [...r.wrap].reverse()) rule = `${w}{${rule}}`;
            lines.push(rule);
            rules++;
        }
        if (lines.length) blocks.push(`/* ${path.relative(PUB, f)} */`, ...lines);
    }
    return { css: `/* generated by scripts/build-hidpi-assets.js (Yozora #921): the stylesheets' HiDPI art at ${t.s}x for a page-scaled desktop */\n${blocks.join('\n')}\n`, rules };
}

function writeBgSheets(index) {
    const counts = {};
    for (const t of TIERS) {
        const { css, rules } = bgSheet(index, t.id);
        writeIfChanged(path.join(OUT, String(t.id), 'bg.css'), Buffer.from(css));
        counts[t.id] = `${rules} rules, ${(css.length / 1024).toFixed(0)} KB`;
    }
    console.log({ bgSheets: counts });
}

// ---------------------------------------------------------------- the stylesheet rewrite
function imageSetFor(rel, quote, e) {
    const q = quote || '';
    const parts = [`url(${q}/static_images/${rel}${q}) 1x`];
    for (const t of TIERS) {
        const d = density(e, t);
        if (d) parts.push(`url(${q}${variantUrl(rel, e.x || path.extname(rel), t.id)}${q}) ${d}x`);
    }
    return `image-set(${parts.join(', ')})`;
}

function rewriteCss(css, index) {
    let changed = 0;
    // our own earlier rewrite: rebuilt from the index (a tier added or a density changed)
    css = css.replace(/image-set\(url\((['"]?)\/static_images\/([^'")\s]+)\1\) 1x(?:, url\(\1\/static_images\/hidpi\/[^)]*\) [\d.]+x)+\)/g, (all, q, rel) => {
        const e = index.a[rel];
        const next = e ? imageSetFor(rel, q, e) : `url(${q}/static_images/${rel}${q})`;
        if (next !== all) changed++;
        return next;
    });
    const out = [];
    let last = 0;
    const re = /url\(\s*(['"]?)\/static_images\/([^'")\s?#]+)\1\s*\)/g;
    let m;
    while ((m = re.exec(css))) {
        const rel = m[2];
        const e = index.a[rel];
        if (!e) continue;
        // already inside an image-set (hand-written @2x sets, or ours): leave it
        const before = css.slice(Math.max(0, m.index - 400), m.index);
        const open = before.lastIndexOf('image-set(');
        if (open >= 0 && before.lastIndexOf(';') < open && before.lastIndexOf('}') < open) continue;
        out.push(css.slice(last, m.index), imageSetFor(rel, m[1], e));
        last = m.index + m[0].length;
        changed++;
    }
    out.push(css.slice(last));
    return { css: out.join(''), changed };
}

function dirtyFiles() {
    try {
        return new Set(execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().split('\n').filter(Boolean).map((l) => path.join(ROOT, l.slice(3))));
    } catch (_) { return new Set(); }
}

function cssRewrite() {
    const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
    const dirty = flag('--include-dirty') ? new Set() : dirtyFiles();
    let total = 0;
    const skipped = [];
    for (const f of cssFiles()) {
        const css = fs.readFileSync(f, 'utf8');
        const r = rewriteCss(css, index);
        if (!r.changed) continue;
        if (dirty.has(f)) { skipped.push(path.relative(ROOT, f)); continue; }
        total += r.changed;
        console.log(`${String(r.changed).padStart(4)}  ${path.relative(ROOT, f)}`);
        if (flag('--write')) fs.writeFileSync(f, r.css);
    }
    console.log(`${total} references ${flag('--write') ? 'rewritten' : 'to rewrite (dry run)'}`);
    if (skipped.length) console.log(`skipped (uncommitted edits, rerun later): ${skipped.join(', ')}`);
    if (flag('--write')) writeBgSheets(index);
}

if (require.main === module) (async () => {
    mkdirp(CACHE);
    if (opt('--index-vista')) return indexVista(path.resolve(opt('--index-vista')));
    if (flag('--css')) return cssRewrite();
    return build();
})().catch((err) => { console.error(err); process.exit(1); });

module.exports = { rewriteCss, TIERS };
