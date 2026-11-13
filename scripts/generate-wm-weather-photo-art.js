#!/usr/bin/env node
/**
 * Lifelike art for Melaton Weather (Yozora #792; Yukimi, Nov 13: "more polished / lifelike instead of
 * cartoony"). Replaces the SVG art of scripts/generate-wm-weather-art.js:
 *   condition icons     wx-<icon>.png / @2x / @4x (64 / 128 / 256), then the sprite sheet
 *                       (scripts/build-wm-weather-sprites.sh)
 *   scene clouds        cloud-a|b|c(-dark).png / @2x: real cumulus and rain-cloud fragments
 *   moon, sun           moon.png / @2x, sun.png / @2x (sun = disc with its corona)
 *   landscape           land.png / @2x and land-snow.png / @2x: the horizon under the sky
 * generated as transparent PNGs by gpt-image (TokenRouter, the key Program Icons uses), trimmed and
 * scaled here; and, drawn here (seamless tiles, no model): rain.png / @2x (motion-blurred streaks)
 * and snow.png / @2x (soft flakes of several sizes).
 *
 *   node scripts/generate-wm-weather-photo-art.js [names...]     (no names: everything)
 *   WX_QUALITY=high  WX_FORCE=1 (ignore cached renders)
 *
 * Raw renders are kept in ~/.cache/wm-weather-art/raw/<name>.png, so a rerun only pays for what is new.
 * The scene art (clouds, moon, sun, land) is then shipped as WebP: after a run,
 *   cd public/static_images/wm61/weather && for f in land land-snow cloud-a cloud-b cloud-c cloud-a-dark \
 *     cloud-b-dark cloud-c-dark moon sun; do for x in "" @2x; do magick "$f$x.png" -quality 86 \
 *     -define webp:alpha-quality=90 -define webp:method=6 "$f$x.webp" && rm "$f$x.png"; done; done
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'static_images', 'wm61', 'weather');
const RAW = path.join(os.homedir(), '.cache', 'wm-weather-art', 'raw');
const QUALITY = process.env.WX_QUALITY || 'high';
const MODEL = process.env.WX_MODEL || 'gpt-image-2.5-sunburst';

const STYLE_ICON = 'A photorealistic weather icon: a real, natural-looking subject rendered with true-to-life lighting, '
    + 'volume and texture, like a high-end photographic weather app icon. Not a cartoon, not flat, no outlines, no '
    + 'clip-art shapes, no emoji style. Centred, filling about 80 % of the square, seen straight on. Transparent '
    + 'background: no sky, no backdrop, no frame, plate, circle or rounded square, no drop shadow, no text. Soft '
    + 'natural edges on clouds (no hard cut-out fringe).';
const STYLE_CLOUD = 'A single real cloud photographed against the sky, cut out on a transparent background: soft, '
    + 'natural wispy edges fading to transparent, true volume and light. No sky colour, no ground, no other objects, '
    + 'no text. The cloud fills the frame side to side with a little margin.';

const JOBS = {
    // condition icons
    'wx-clear-day': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: the sun on a clear day: a brilliant warm-white and golden sun disc with a soft natural corona glow and gentle light rays, as seen through a camera.` },
    'wx-clear-night': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: a clear night: a realistic crescent moon with visible lunar surface detail in soft silver light, two or three small faint stars beside it.` },
    'wx-partly-day': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: partly cloudy: a real bright sun with a soft glow partly hidden behind a fluffy white sunlit cumulus cloud in front, lower right.` },
    'wx-partly-night': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: partly cloudy night: a realistic crescent moon in silver light partly behind a soft moonlit grey-blue cloud in front, lower right.` },
    'wx-cloudy': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: overcast: a cluster of real cumulus clouds, white tops shading to soft grey undersides, layered with depth.` },
    'wx-fog': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: fog: soft horizontal bands of real mist and low haze, pale grey-white, layered and translucent.` },
    'wx-drizzle': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: drizzle: a light grey real cloud with fine, sparse, thin drizzle streaks falling from its base.` },
    'wx-rain': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: rain: a dark grey rain cloud with real falling rain, slanted motion-blurred streaks of water below it.` },
    'wx-sleet': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: sleet: a cold grey cloud with a mix of falling rain streaks and small translucent ice pellets below it.` },
    'wx-snow': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: snow: a pale grey snow cloud with real snowflakes falling below it, some sharp, some soft out of focus.` },
    'wx-storm': { size: '1024x1024', prompt: `${STYLE_ICON} Subject: thunderstorm: a dark towering storm cloud with a bright, realistic branching lightning bolt striking down from its base, a faint glow inside the cloud.` },
    // scene clouds (light: sunlit cumulus; dark: rain-cloud fragments)
    'cloud-a': { size: '1536x1024', prompt: `${STYLE_CLOUD} A broad, fluffy fair-weather cumulus cloud, bright white sunlit top, soft grey-blue shaded base.` },
    'cloud-b': { size: '1536x1024', prompt: `${STYLE_CLOUD} A small rounded cumulus puff, bright white with soft shading, compact.` },
    'cloud-c': { size: '1536x1024', prompt: `${STYLE_CLOUD} A long, low, stretched stratocumulus cloud band, white with soft grey shading, wide and thin.` },
    'cloud-a-dark': { size: '1536x1024', prompt: `${STYLE_CLOUD} A broad, heavy dark grey rain cloud (nimbostratus fragment), dense, slate grey with darker base and slightly lighter top.` },
    'cloud-b-dark': { size: '1536x1024', prompt: `${STYLE_CLOUD} A small, dense dark grey storm cloud puff, slate grey with a darker underside.` },
    'cloud-c-dark': { size: '1536x1024', prompt: `${STYLE_CLOUD} A long, low, dark grey rain cloud band, wide and thin, slate grey with a ragged darker base.` },
    // sky bodies
    'moon': { size: '1024x1024', prompt: 'A photorealistic full moon as seen through a telescope: the real lunar surface with maria and craters, soft silver-grey, a perfect circle filling 90 % of the square. Transparent background around it, no glow, no stars, no text.' },
    'sun': { size: '1024x1024', prompt: 'A photorealistic sun in the sky as photographed: a brilliant white-gold disc in the centre with a soft, wide golden corona glow fading smoothly to transparent at the edges of the square. Transparent background, no lens flare streaks, no sky colour, no text.' },
    // the horizon under the sky
    'land': { size: '1536x1024', prompt: 'A photorealistic distant landscape horizon seen from a hill: rolling green hills and soft treelines with atmospheric perspective, the far hills paler and bluer. The land fills only the bottom 40 % of the image; everything above the land is fully transparent (no sky, no clouds, no sun). Natural daylight, no buildings, no people, no text.' },
    'land-snow': { size: '1536x1024', prompt: 'A photorealistic distant winter landscape horizon seen from a hill: rolling snow-covered hills and dark snowy treelines with atmospheric perspective, the far hills paler and bluer. The land fills only the bottom 40 % of the image; everything above it is fully transparent (no sky, no clouds). Soft overcast light, no buildings, no people, no text.' }
};

// output sizes: [name, 1x width (or icon square), has @4x]
const ICON_SIZES = [64, 128, 256];
const CLOUD_W = { 'cloud-a': 300, 'cloud-b': 200, 'cloud-c': 340 };

function tokenRouterKey() {
    const sec = JSON.parse(fs.readFileSync(path.join(ROOT, 'secure.config.json'), 'utf8'));
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    const keys = (sec.tokenrouter && sec.tokenrouter.keys) || [];
    const sel = (cfg.selectedApiKeys || {}).tokenrouter;
    const k = Number.isInteger(sel) && keys[sel] ? keys[sel] : keys.find((e) => e && e.apiKey);
    if (!k) throw new Error('No TokenRouter key in secure.config.json');
    return String(k.apiKey).trim();
}

let client = null;
async function render(name) {
    const file = path.join(RAW, `${name}.png`);
    if (fs.existsSync(file) && !process.env.WX_FORCE) return fs.readFileSync(file);
    if (!client) client = new OpenAI({ apiKey: tokenRouterKey(), baseURL: 'https://api.tokenrouter.com/v1', timeout: 240000, maxRetries: 0 });
    const job = JOBS[name];
    for (let attempt = 1; ; attempt++) {
        try {
            const r = await client.images.generate({ model: `openai/${MODEL}`, prompt: job.prompt, background: 'transparent', output_format: 'png', size: job.size, quality: QUALITY, n: 1 });
            const b64 = r && r.data && r.data[0] && r.data[0].b64_json;
            if (!b64) throw new Error('no picture in the answer');
            const buf = Buffer.from(b64, 'base64');
            fs.mkdirSync(RAW, { recursive: true });
            fs.writeFileSync(file, buf);
            console.log(`rendered ${name}`);
            return buf;
        } catch (error) {
            const wait = error && error.status === 429 ? 65000 : 8000;
            if (attempt >= 4) throw error;
            console.log(`${name}: ${error.message} (retry ${attempt} in ${wait / 1000} s)`);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
}

const png = (s) => s.png({ compressionLevel: 9, adaptiveFiltering: true });

/** Trim the transparent margin (alpha below ~3 %), then the shape is the content's own. */
async function trimmed(buf) {
    return sharp(buf).trim({ threshold: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
}

async function writeIcon(name, buf) {
    // square, centred, a 6 % margin like the old art
    const t = await trimmed(buf);
    const meta = await sharp(t).metadata();
    const side = Math.round(Math.max(meta.width, meta.height) / 0.88);
    const square = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: t, left: Math.round((side - meta.width) / 2), top: Math.round((side - meta.height) / 2) }]).png().toBuffer();
    for (const [i, s] of ICON_SIZES.entries()) {
        const suffix = ['', '@2x', '@4x'][i];
        await png(sharp(square).resize(s, s, { kernel: 'lanczos3' })).toFile(path.join(OUT, `${name}${suffix}.png`));
    }
}

async function writeWide(name, buf, width1x, keepBottom) {
    let t = keepBottom ? buf : await trimmed(buf);
    if (keepBottom) {
        // the landscape: crop to the land (the bottom band with content), full width
        const { info, data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let top = 0;
        for (let y = 0; y < info.height; y++) {
            let solid = 0;
            for (let x = 0; x < info.width; x += 4) if (data[(y * info.width + x) * 4 + 3] > 200) solid++;
            if (solid > info.width / 4 / 3) { top = Math.max(0, y - 40); break; }
        }
        t = await sharp(buf).extract({ left: 0, top, width: info.width, height: info.height - top }).png().toBuffer();
    }
    await png(sharp(t).resize({ width: width1x, kernel: 'lanczos3' })).toFile(path.join(OUT, `${name}.png`));
    await png(sharp(t).resize({ width: width1x * 2, kernel: 'lanczos3' })).toFile(path.join(OUT, `${name}@2x.png`));
}

// ---------------------------------------------------------------- procedural tiles (seamless)

function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

async function rainTile() {
    for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
        const W = 256 * scale;
        const H = 512 * scale;
        const r = rng(7);
        let lines = '';
        for (let i = 0; i < 120; i++) {
            const x = r() * W;
            const y = r() * H;
            const len = (18 + r() * 46) * scale;
            const a = 0.18 + r() * 0.5;
            const w = (0.6 + r() * 1.1) * scale;
            const dx = len * 0.12;
            for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
                lines += `<line x1="${(x + ox).toFixed(1)}" y1="${(y + oy).toFixed(1)}" x2="${(x + ox + dx).toFixed(1)}" y2="${(y + oy + len).toFixed(1)}" stroke="url(#g)" stroke-opacity="${a.toFixed(2)}" stroke-width="${w.toFixed(2)}" stroke-linecap="round"/>`;
            }
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfeaf5" stop-opacity="0"/><stop offset="0.7" stop-color="#eef5fc"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
            <filter id="b" x="-20%" y="-5%" width="140%" height="110%"><feGaussianBlur stdDeviation="${(0.35 * scale).toFixed(2)} ${(1.2 * scale).toFixed(2)}"/></filter></defs>
            <g filter="url(#b)">${lines}</g></svg>`;
        await png(sharp(Buffer.from(svg))).toFile(path.join(OUT, `rain${suffix}.png`));
    }
    console.log('drew rain');
}

async function snowTile() {
    for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
        const W = 256 * scale;
        const H = 256 * scale;
        const r = rng(11);
        let dots = '';
        for (let i = 0; i < 70; i++) {
            const x = r() * W;
            const y = r() * H;
            const near = r();
            const rad = (0.8 + near * near * 3.2) * scale;
            const a = 0.5 + near * 0.45;
            const blur = near > 0.8 ? 'url(#bb)' : near > 0.4 ? 'url(#b)' : '';
            for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
                dots += `<circle cx="${(x + ox).toFixed(1)}" cy="${(y + oy).toFixed(1)}" r="${rad.toFixed(2)}" fill="#ffffff" fill-opacity="${a.toFixed(2)}"${blur ? ` filter="${blur}"` : ''}/>`;
            }
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
            <filter id="b"><feGaussianBlur stdDeviation="${(0.5 * scale).toFixed(2)}"/></filter>
            <filter id="bb"><feGaussianBlur stdDeviation="${(1.4 * scale).toFixed(2)}"/></filter></defs>${dots}</svg>`;
        await png(sharp(Buffer.from(svg))).toFile(path.join(OUT, `snow${suffix}.png`));
    }
    console.log('drew snow');
}

// ---------------------------------------------------------------- main

(async () => {
    const want = process.argv.slice(2);
    const names = want.length ? want : [...Object.keys(JOBS), 'rain', 'snow'];
    if (names.includes('rain')) await rainTile();
    if (names.includes('snow')) await snowTile();
    const model = names.filter((n) => JOBS[n]);
    // two at a time: TokenRouter's image rate window
    for (let i = 0; i < model.length; i += 2) {
        await Promise.all(model.slice(i, i + 2).map(async (name) => {
            const buf = await render(name);
            if (name.startsWith('wx-')) await writeIcon(name, buf);
            else if (name.startsWith('cloud-')) await writeWide(name, buf, CLOUD_W[name.replace('-dark', '')]);
            else if (name === 'moon') { const t = await trimmed(buf); await png(sharp(t).resize(96, 96)).toFile(path.join(OUT, 'moon.png')); await png(sharp(t).resize(192, 192)).toFile(path.join(OUT, 'moon@2x.png')); }
            else if (name === 'sun') { await png(sharp(buf).resize(160, 160)).toFile(path.join(OUT, 'sun.png')); await png(sharp(buf).resize(320, 320)).toFile(path.join(OUT, 'sun@2x.png')); }
            else if (name.startsWith('land')) await writeWide(name, buf, 480, true);
            console.log(`wrote ${name}`);
        }));
    }
})().catch((error) => { console.error(error); process.exit(1); });
