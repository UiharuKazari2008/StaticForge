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
 * What Vista itself draws at 120 / 144 / 192 DPI is the reference (#986, checked on a Vista clone at 120 DPI):
 * theme art is never upscaled - aero.msstyles carries per-DPI images and uxtheme picks one by MINDPI and
 * draws it at its own size - and an icon slot takes the icon's next larger frame, reduced (a 16 px icon at
 * 120 DPI is its 32 px drawing at 20 px). Upscaling the 1x art is the last resort, not the rule.
 *
 * Where each variant comes from, best first (the "m" field of index.json):
 *   vista       Vista's own art at that density: for theme art (the 1x is one of aero.msstyles' per-DPI
 *               images, or one state cell of it, matched by pixels) the image Vista picks at the tier's DPI
 *               (largest MINDPI <= DPI), centred at its own size in the tier's cell ('vista-true': the 96 DPI
 *               image itself, as the tree's +/- at 120 DPI; 'vista-stretch': TRUESIZESCALINGTYPE DPI past its
 *               TRUESIZESTRETCHMARK, stretched by DPI / MINDPI as uxtheme does); for icons the frame of that
 *               exact size in the Vista icon group the 1x was cut from (found by matching its pixels against
 *               the icon groups of Vista's DLLs, --index-vista; a 1x captured from the screen is matched over
 *               the colour behind it, up to 1 px off, and its copies are drawn over the same colour)
 *   vista-down  an exact Hermite downscale of a larger Vista frame (how Vista itself draws a 20 px icon
 *               at 120 DPI from the 32 px frame; explorer-tree note: Hermite matches the VM to 0.5 %)
 *   sibling     a larger copy of the same art already in the tree (foo-32.png for foo-16.png, foo@2x.png;
 *               icon sizes only - a trailing resource id is not a size - and only when its shape is the
 *               1x's), used as it is when it has the target size, else Hermite-downscaled
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

// Vista's system small icon (SM_CXSMICON / SHIL_SYSSMALL) at each tier's DPI, read on a Vista clone at 120 / 144 /
// 168 / 192 DPI (#986): 22 / 26 / 30 / 36 px, not 16 x scale (the shell's own small list, Explorer's details view,
// is 20 / 24 / 28 / 32). Every 16 px icon also gets a copy at that size, hidpi/<tier>/@sysicon/<path>, and the
// tier's img.css draws it, at --vs-smicon, in the places Vista uses the system small icon.
const SYSICON = { 125: 22, 150: 26, 175: 30, 200: 36 };
const SYSICON_DIR = '@sysicon';
// measured on the clone at 120 / 144 DPI: Explorer's navigation pane (Favorite Links and the Folders tree) draws
// 22 / 26 px icons; its details view 20 / 24; MMC consoles (Device Manager) keep 16 px at true size
const SYSICON_CONTEXTS = ['.explorer-favorite-link', '.explorer-tree-label'];
const isSysIcon = (p) => p.w === 16 && p.h === 16 && !p.vo && !p.slices;

// Explorer's travel band (the back / forward orbs, Recent Pages and the groove round them) is one control that
// Vista sizes from its Navigation art, not from the DPI: at 144 and 168 DPI it keeps the 120 DPI orbs at their
// own size and the groove hugs them, and only at 192 DPI does the art stretch (x1.6, TRUESIZESTRETCHMARK).
// So the band's tier copies are made at the band's own scale, and where that differs from the tier's
// (150 / 175 %) the tier's img.css sets --vs-nav-k (zoom on the band's boxes) and --vs-nav-bs-* (the art's
// size in CSS px) for the stylesheets that draw it (#986).
const NAV_BAND = { 'vista-explorer/nav-back.png': 'orb', 'vista-explorer/nav-forward.png': 'orb', 'vista-explorer/recent-pages.png': 'recent', 'vista-explorer/travel-gutter.png': 'gutter' };
function bandScale(t) {
    if (!themeParts) themeParts = msstylesDpiParts();
    const nav = themeParts.find((q) => q.cls === 'Navigation' && q.part === 1);
    if (!nav) return t.s;
    const dpi = Math.round(96 * t.s);
    const im = vistaImageAt(nav.images, dpi);
    const ratio = dpi / im.dpi;
    const stretch = nav.tsst === 2 && nav.stretchMark != null && ratio >= 1 + nav.stretchMark / 100;
    return (im.dpi / 96) * (stretch ? ratio : 1);
}

// the box round a picture's visible pixels (alpha over half): { x, y, w, h }
async function contentBox(spec) {
    const out = await magick([spec, '-alpha', 'extract', '-threshold', '50%', '-format', '%@', 'info:']);
    const m = /(\d+)x(\d+)\+(\d+)\+(\d+)/.exec(String(out));
    return m ? { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } : null;
}

// the desktop's art; the phone's (wm61, wm65, wm-android) has its own @2x / @4x packages, the Vista
// games their own HiDPI build (build-vista-games-hidpi.sh), gadget packages draw in their own frames
const INCLUDE = /^(?:vista-(?!gadgets\/|games\/)[a-z0-9-]+|window-controls|activesync|account-pictures|melaton|cpu|xyridian)\//;
const EXCLUDE = /(?:^|\/)originals\/|@\d(?:\.\d+)?x\.[a-z]+$/i;
const RASTER = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const MAX_AREA = 600000; // bigger art is shown scaled down already (logos, marks, sources)
const MAX_SIDE = 256; // art at least this big both ways (256 px icon frames, logos): Vista has nothing larger
// and an upscale adds bytes, not sharpness

// Vista's own art at other densities (#986). aero.msstyles (PREMULTIPLIED) gives 69 parts two to four images,
// each with a MINDPI: uxtheme draws the image with the largest MINDPI <= the screen's DPI at its own size
// (check box 13 / 16 / 25 px at 96 / 118 / 185, Start orb 96 / 120 / 144 / 192, tree +/- 96 / 133 / 150 - so
// at 120 DPI the tree keeps its 96 DPI glyph) and never stretches it to the DPI. Every 1x asset cut from one
// of those images (the whole strip or one state cell) is matched by its pixels; its tier copy is the image
// Vista picks at the tier's DPI, each cell centred in round(cell x scale) (true size, as Vista draws it), and
// reduced only where Vista's own image is larger than that cell (Vista grows the control instead).
const AERO = path.join(os.homedir(), '.cache/vista-vm/aero');
const TMT_IMAGEFILE1 = 3002; // ..3006 = IMAGEFILE1..5
const TMT_MINDPI1 = 2420; // ..2424 = MINDPI1..5
const TMT_IMAGECOUNT = 2401;
const TMT_TRUESIZESTRETCHMARK = 2419; // % past the image's own size at which a true-size image stretches
const TMT_TRUESIZESCALINGTYPE = 4015; // 2 = TSST_DPI: stretched by screen DPI / the image's MINDPI

// the parts of aero.msstyles' Normal variant that carry per-DPI images: [{ cls, part, state, count, images: [{ id, dpi }] }]
function msstylesDpiParts() {
    const cmap = path.join(AERO, 'CMAP_CMAP.bin'); const variant = path.join(AERO, 'VARIANT_NORMAL.bin');
    if (!fs.existsSync(cmap) || !fs.existsSync(variant)) return [];
    // class names are UTF-16, each padded with NULs to 8 bytes; a record's class is the index among the names
    const classes = fs.readFileSync(cmap).toString('utf16le').split('\0').filter(Boolean);
    const v = fs.readFileSync(variant);
    const parts = new Map();
    for (let o = 0; o + 32 <= v.length;) {
        const [name, , cls, part, state, short, , size] = Array.from({ length: 8 }, (_, i) => v.readInt32LE(o + i * 4));
        o += 32;
        let value = short;
        if (size && !short) { value = size >= 4 ? v.readInt32LE(o) : 0; o = (o + size + 7) & ~7; }
        const key = `${cls}|${part}|${state}`;
        if (!parts.has(key)) parts.set(key, { cls: classes[cls] || String(cls), part, state, props: new Map() });
        parts.get(key).props.set(name, value);
    }
    const out = [];
    for (const p of parts.values()) {
        const images = [];
        for (let i = 0; i < 5; i++) {
            const id = p.props.get(TMT_IMAGEFILE1 + i); const dpi = p.props.get(TMT_MINDPI1 + i);
            if (id && dpi) images.push({ id, dpi, file: `IMAGE_${id}.png` });
        }
        if (images.length < 2 || !images.every((im) => fs.existsSync(path.join(AERO, im.file)))) continue;
        out.push({ cls: p.cls, part: p.part, state: p.state, count: p.props.get(TMT_IMAGECOUNT) || 1, tsst: p.props.get(TMT_TRUESIZESCALINGTYPE) || 0, stretchMark: p.props.has(TMT_TRUESIZESTRETCHMARK) ? p.props.get(TMT_TRUESIZESTRETCHMARK) : null, images: images.sort((a, b) => a.dpi - b.dpi) });
    }
    return out;
}

// the image Vista draws at a DPI: the largest MINDPI at or below it (the 96 DPI image below the first)
function vistaImageAt(images, dpi) {
    let pick = images[0];
    for (const im of images) if (im.dpi <= dpi) pick = im;
    return pick;
}

const unpremultipliedCache = new Map();
async function aeroPixels(file) {
    if (!unpremultipliedCache.has(file)) {
        unpremultipliedCache.set(file, (async () => {
            const px = await rgba(path.join(AERO, file));
            for (let i = 0; i < px.data.length; i += 4) {
                const a = px.data[i + 3];
                for (let c = 0; c < 3; c++) px.data[i + c] = a === 0 ? 0 : Math.min(255, Math.round(px.data[i + c] * 255 / a));
            }
            return px;
        })());
    }
    return unpremultipliedCache.get(file);
}

// a 1x asset that is one of those images (whole strip) or one cell of it, matched by pixels
let themeParts = null;
async function matchTheme(rel, m) {
    if (!themeParts) themeParts = msstylesDpiParts();
    const px = await rgba(path.join(SI, rel));
    const seen = new Set();
    for (const p of themeParts) {
        const base = p.images[0];
        if (seen.has(base.id)) continue;
        seen.add(base.id);
        const img = await aeroPixels(base.file);
        if (img.w !== m.w || img.h % m.h) continue;
        const cells = img.h / m.h;
        for (let i = 0; i < cells; i++) {
            const cell = { data: img.data.subarray(i * m.h * img.w * 4, (i + 1) * m.h * img.w * 4) };
            if (diff(px.data, cell.data) < 2) {
                // a whole strip steps by the part's own state count; a cut cell is one cell of `cells`
                const whole = cells === 1;
                const n = whole ? (m.h % Math.max(1, p.count) ? 1 : Math.max(1, p.count)) : cells;
                return { part: `${p.cls}:${p.part}:${p.state}`, tsst: p.tsst, stretchMark: p.stretchMark, images: p.images.map(({ id, dpi, file }) => ({ id, dpi, file })), cells: n, index: whole ? null : i, cell: [m.w, whole ? m.h / n : m.h] };
            }
        }
    }
    return null;
}

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

// a 1x icon captured from the screen is opaque: the frame drawn over the colour behind it (the colour of the
// capture where the frame is clear), sometimes cut a pixel off centre (fav-documents). Compared over the
// frame's own pixels at shifts of up to 1 px; null when the frame has no clear pixel.
function diffMatted(cap, frame, size) {
    let best = null;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            // the frame's pixel under capture pixel (x, y), clear outside the frame
            const at = (x, y) => { const fx = x - dx; const fy = y - dy; return fx < 0 || fy < 0 || fx >= size || fy >= size ? -1 : (fy * size + fx) * 4; };
            let r = 0; let g = 0; let b = 0; let n = 0;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const f = at(x, y); const i = (y * size + x) * 4;
                if (f < 0 || frame[f + 3] === 0) { r += cap[i]; g += cap[i + 1]; b += cap[i + 2]; n++; }
            }
            if (n < 4) continue;
            const matte = [r / n, g / n, b / n];
            let sum = 0; let m = 0;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const f = at(x, y); const i = (y * size + x) * 4;
                const a = f < 0 ? 0 : frame[f + 3] / 255;
                if (!a) continue;
                for (let c = 0; c < 3; c++) sum += Math.abs(cap[i + c] - (frame[f + c] * a + matte[c] * (1 - a)));
                m += 3;
            }
            if (m && (!best || sum / m < best.d)) best = { d: sum / m, matte: matte.map(Math.round) };
        }
    }
    return best;
}

async function matchVista(px) {
    if (px.w !== px.h || px.w > 64) return null;
    let opaque = true;
    for (let i = 3; i < px.data.length; i += 4) if (px.data[i] !== 255) { opaque = false; break; }
    let best = null;
    for (const c of await vistaFrames(px.w)) {
        if (opaque) {
            const r = diffMatted(px.data, c.px.data, px.w);
            if (r && (!best || r.d < best.d)) best = { d: r.d, g: c.g, matte: r.matte };
        } else {
            const d = diff(px.data, c.px.data);
            if (!best || d < best.d) best = { d, g: c.g };
            if (d === 0) break;
        }
    }
    // an icon extracted at its own size is the frame; a little drift (a rescaled /icon export) still counts.
    // A screen capture also carries the matte's rounding and ClearType-free edge blending: 3 levels per channel.
    if (process.env.HIDPI_DEBUG && best) console.error(`match ${px.w} d=${best.d.toFixed(2)} ${best.g.file}#${best.g.gid}${best.matte ? ' matted' : ''}`);
    return best && best.d < (best.matte ? 3 : 1.5) ? best : null;
}

// the frame sizes icons come in (a file name's trailing number is only a size when it is one of these)
const ICON_SIZES = new Set([10, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 42, 44, 48, 52, 56, 60, 64, 72, 80, 96, 128, 192, 256]);

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
    // dimensions, so atlases of icons qualify too). Only icon sizes on both sides and a real step up: a
    // trailing number is as often a resource id (inetcpl-4483 / inetcpl-4498 are the magnifier and the RSS
    // feed icon, "1.0033x" apart by name), which made 33 tier copies the wrong icon (#986).
    const mm = /^(.*?[-_])(\d+)(\.[a-z]+)$/i.exec(base);
    if (mm && ICON_SIZES.has(Number(mm[2]))) {
        const n = Number(mm[2]);
        let names = [];
        try { names = fs.readdirSync(abs); } catch (_) { names = []; }
        for (const name of names) {
            const s = new RegExp(`^${mm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\.(?:png|webp)$`, 'i').exec(name);
            if (!s || !ICON_SIZES.has(Number(s[1])) || Number(s[1]) < n * 1.25) continue;
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

// a larger copy only counts when it is the same art: brought down to the 1x size, its shape (alpha above
// half) must cover the 1x's to 40 % or more (contact-48 is the card drawn small on a larger canvas,
// remote-access-48 another picture; 16 vs 32 redraws of one icon stay well above it)
async function sameShape(px, sib) {
    let clear = 0;
    for (let i = 3; i < px.data.length; i += 4) if (px.data[i] < 128) clear++;
    if (!sib.length || clear < px.data.length / 4 * 0.05) return sib; // an opaque 1x: nothing to compare
    const out = [];
    for (const s of sib) {
        const { data } = await sharp(path.join(SI, s.rel)).ensureAlpha().resize(px.w, px.h, { kernel: 'cubic', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
        let both = 0; let either = 0;
        for (let i = 3; i < data.length; i += 4) {
            const a = px.data[i] >= 128; const b = data[i] >= 128;
            if (a && b) both++;
            if (a || b) either++;
        }
        if (!either || both / either >= 0.4) out.push(s);
    }
    return out;
}

// ---------------------------------------------------------------- planning
async function planOne(rel, slices) {
    const m = await meta(rel);
    if (m.pages > 1) return { rel, skip: 'animated' };
    if (m.w * m.h > MAX_AREA || Math.min(m.w, m.h) >= MAX_SIDE) return { rel, skip: 'large' };
    const plan = { rel, w: m.w, h: m.h, format: m.format, sources: [] };
    const ext = path.extname(rel).toLowerCase();
    plan.outExt = ext === '.gif' || ext === '.bmp' ? '.png' : ext;
    // best first: Vista's own image for that DPI, the icon's own larger frames, a larger copy in the tree
    const vo = await matchTheme(rel, m);
    if (NAV_BAND[rel]) plan.band = NAV_BAND[rel];
    if (vo) { plan.method = 'vista'; plan.vo = vo; return plan; }
    const sl = slices.get(rel);
    if (sl) plan.slices = sl;
    const px = await rgba(path.join(SI, rel));
    const a = analyse(px);
    if (!sl) {
        const v = await matchVista(px);
        if (v) {
            const sizes = Object.keys(v.g.frames).map(Number).filter((s) => s > m.w);
            if (sizes.length) {
                plan.method = 'vista'; plan.icon = v.g; plan.iconDiff = v.d;
                if (v.matte) plan.matte = v.matte;
                return plan;
            }
        }
    }
    const sib = await sameShape(px, siblings(rel, m));
    if (sib.length) { plan.method = 'sibling'; plan.sib = sib; return plan; }
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
    if (p.band) t = { id: t.id, s: bandScale(t) };
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
        // one copy at (w, h) for tier t (t.s: the scale the methods size by)
        const make = async (t, w, h, out) => {
            let used = record.m;
            if (p.vo) {
                // the image Vista draws at this tier's DPI, each cell at its own size centred in the tier's cell
                // ('vista-true': the 96 DPI image itself, as Vista keeps it below the part's next MINDPI);
                // reduced only where Vista's image is larger than the cell
                const dpi = Math.round(96 * t.s);
                const im = vistaImageAt(p.vo.images, dpi);
                const f = await unpremultiplied(path.join(AERO, im.file), tmp);
                const fm = await sharp(f).metadata();
                const scw = fm.width; const sch = Math.round(fm.height / p.vo.cells);
                // TSST_DPI with a stretch mark: past that share over the image's own DPI Vista stretches it by
                // the DPI ratio (the nav buttons' 120 DPI art at 192 DPI: x1.6); below it, true size
                const ratio = dpi / im.dpi;
                const stretch = p.vo.tsst === 2 && p.vo.stretchMark != null && ratio >= 1 + p.vo.stretchMark / 100;
                const take = p.vo.index == null ? Array.from({ length: p.vo.cells }, (_, i) => i) : [p.vo.index];
                const cw = w; const ch = h / take.length;
                const cells = [];
                used = im.dpi === 96 ? 'vista-true' : 'vista';
                // the art at the size Vista draws it: its own, or stretched evenly by the DPI ratio
                const art = path.join(tmp, 'art.png');
                if (stretch) {
                    await magick([f, ...FILTER.soft, '-resize', `${Math.round(scw * ratio)}x${Math.round(sch * ratio) * p.vo.cells}!`, `PNG32:${art}`]);
                    used = 'vista-stretch';
                } else await magick([f, `PNG32:${art}`]);
                const aw = stretch ? Math.round(scw * ratio) : scw; const ah = stretch ? Math.round(sch * ratio) : sch;
                // larger than the cell (the orbs' 120 DPI cells are 38x38, mostly margin): the cell is cut from it
                // where the 1x art's visible part sits, scaled - never shrunk, so the orb keeps Vista's size
                let at = null;
                if (aw > cw || ah > ch) {
                    const one = await contentBox(`${path.join(SI, p.rel)}[${p.w}x${p.vo.index == null ? p.h / p.vo.cells : p.h}+0+0]`);
                    const big = await contentBox(`${art}[${aw}x${ah}+0+0]`);
                    const k = cw / p.vo.cell[0];
                    if (one && big && big.w <= cw && big.h <= ch) {
                        // the visible part where the 1x has it (scaled), kept inside the cell
                        const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
                        at = {
                            x: clamp(Math.round(one.x * k) - big.x, -big.x, cw - big.x - big.w),
                            y: clamp(Math.round(one.y * k) - big.y, -big.y, ch - big.y - big.h)
                        };
                    }
                }
                for (const i of take) {
                    const c = path.join(tmp, `c${i}.png`);
                    const cell = `${art}[${aw}x${ah}+0+${i * ah}]`;
                    if (aw <= cw && ah <= ch) {
                        await magick([cell, '-background', 'none', '-gravity', 'center', '-extent', `${cw}x${ch}`, `PNG32:${c}`]);
                    } else if (at) {
                        await magick(['-size', `${cw}x${ch}`, 'xc:none', '(', cell, '+repage', ')', '-geometry', `${at.x >= 0 ? '+' : ''}${at.x}${at.y >= 0 ? '+' : ''}${at.y}`, '-compose', 'over', '-composite', `PNG32:${c}`]);
                        if (!stretch) used = 'vista-true';
                    } else {
                        await resize(cell, cw, ch, 'down', c);
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
                // a captured 1x is the icon over its background: the tier copy too, over the same colour
                if (p.matte) await magick([out, '-background', `rgb(${p.matte.join(',')})`, '-flatten', ...outArgs(out)]);
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
            return used;
        };
        for (const t of TIERS) {
            const { w, h } = tierDims(p, t);
            const out = path.join(dir, `${t.id}${p.outExt}`);
            const used = await make(t, w, h, out);
            const om = await sharp(out).metadata();
            record.t[t.id] = { w: om.width, h: om.height, m: used };
        }
        // the system small icon size of each tier (SYSICON), from the same source
        if (isSysIcon(p)) {
            record.sys = {};
            for (const t of TIERS) {
                const size = SYSICON[t.id];
                const out = path.join(dir, `${t.id}-sys${p.outExt}`);
                const used = await make({ id: t.id, s: size / 16 }, size, size, out);
                record.sys[t.id] = { w: size, h: size, m: used };
            }
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
        const entry = { w: p.w, h: p.h, x: p.outExt === path.extname(p.rel).toLowerCase() ? undefined : p.outExt, m: rec.m, s: rec.sys ? 1 : undefined, t: {} };
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
            if (p.rec.sys) {
                const sys = fs.readFileSync(path.join(k, `${t.id}-sys${p.outExt}`));
                sizes[t.id] += sys.length;
                if (writeIfChanged(path.join(OUT, String(t.id), SYSICON_DIR, p.rel.replace(/\.[a-z]+$/i, p.outExt)), sys)) written++;
            }
        }
    }
    // the <img> overrides, one sheet per tier
    for (const t of TIERS) {
        const lines = [`/* generated by scripts/build-hidpi-assets.js (Yozora #921, #986): <img> art at ${t.s}x */`];
        // Vista's system small icon at this DPI in CSS px (22 px at 125 % = 17.6px); 16px where no tier sheet is linked
        const sysPx = Number((SYSICON[t.id] / t.s).toFixed(4));
        lines.push(`:root{--vs-smicon:${sysPx}px}`);
        const bk = Number((bandScale(t) / t.s).toFixed(4));
        if (Math.abs(bk - 1) > 1e-3) {
            const size = (rel) => { const e = index.a[rel]; return e ? `${e.w}px ${e.h}px` : 'auto'; };
            lines.push(`:root{--vs-nav-k:${bk};--vs-nav-bs-orb:${size('vista-explorer/nav-back.png')};--vs-nav-bs-recent:${size('vista-explorer/recent-pages.png')};--vs-nav-bs-gutter:${size('vista-explorer/travel-gutter.png')}}`);
        }
        const ctx = `:is(${SYSICON_CONTEXTS.join(',')})`;
        for (const [rel, e] of Object.entries(index.a).sort()) {
            const d = density(e, t);
            if (!d) continue;
            const ext = e.x || path.extname(rel);
            lines.push(`img[src="/static_images/${rel}"]{content:image-set(url(${variantUrl(rel, ext, t.id)}) ${d}x)}`);
            // in Vista's system small icon places, the copy at that size (natural size still 16 css px)
            if (e.s) lines.push(`${ctx} img[src="/static_images/${rel}"]{content:image-set(url(${WEB_HIDPI}/${t.id}/${SYSICON_DIR}/${rel.replace(/\.[a-z]+$/i, ext)}) ${Number((SYSICON[t.id] / 16).toFixed(4))}x)}`);
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
    if (p.vo) p.vo.images.forEach((im) => extra.push(fs.readFileSync(path.join(AERO, im.file))));
    const key = sha(Buffer.concat([Buffer.from(`${VERSION}|${p.method}|${isSysIcon(p) ? `sys${JSON.stringify(SYSICON)}|` : ''}${p.band ? `band${JSON.stringify(TIERS.map(bandScale))}|` : ''}${JSON.stringify(p.slices || null)}|${JSON.stringify(p.vo || null)}|${JSON.stringify(p.matte || null)}|`), srcBytes, ...extra]));
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
