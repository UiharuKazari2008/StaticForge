#!/usr/bin/env node
/**
 * The "installation media" for the games Setup offers while it runs (/launch, Yozora #609):
 * one zip per game at public/static_images/vista-games/media/<id>.zip, so a game opened from
 * Setup's Games toolbar arrives in one request (public/scripts/launch/launchGamesHost.js unpacks
 * it into the service worker's static-cache-v1, where the game's requests then find it).
 *
 * Each zip holds the game's feature scripts and styles (featureLoader.js FEATURE_MANIFEST, with
 * their depends), its art packs at 1x (Setup draws the games at 1x inside its 1024 x 768 frame;
 * the @2x sheets and x2 images stay out) and the few files it borrows from other packs. Art and
 * sound go in lighter copies (WebP q70, palette PNG, AAC 48 kbps, Opus 40 kbps) where that saves
 * a tenth or more; Setup's last step replaces them with the full files, from <id>.full.zip (the
 * same files at full quality, one request per game). pack.json (in the zip)
 * and <id>.json (beside it, read first so a game whose files are all cached downloads nothing)
 * list { entry, url, hash, size } with the full file's sha256, and lite: { hash, size } for a
 * lighter copy. Rebuild after any game or asset change:
 *
 *   node scripts/build-vista-games-media.js [--only minesweeper,...]
 *
 * scripts/test-vista-games-media.js fails when a zip no longer matches its source files.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const fflate = require('fflate');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const ART = '/static_images/vista-games/';
const OUT = path.join(PUBLIC, 'static_images/vista-games/media');

// Mahjong's tile clacks and chime (Block Drop, Brick Breaker: MAHJONG_AUDIO in their scripts)
const MAHJONG_SOUNDS = ['mahjong_piececlack01', 'mahjong_piececlack02', 'mahjong_piececlack03', 'mahjong_good']
    .map((n) => ART + 'mahjong/audio/' + n + '.m4a');
const COMMON = [ART + 'ui', ART + 'icons'];

// game -> art folders (whole, 1x) and single files
const GAMES = {
    minesweeper: { dirs: ['minesweeper'] },
    solitaire: { dirs: ['cardgames', 'solitaire'] },
    spider: { dirs: ['cardgames', 'spider'] },
    freecell: { dirs: ['cardgames', 'freecell'] },
    hearts: { dirs: ['cardgames', 'hearts'] },
    blockdrop: { dirs: ['blockdrop', 'minesweeper', 'cardgames'], files: MAHJONG_SOUNDS.concat(['/sounds/planet/innerlight.opus']) },
    brickbreaker: { dirs: ['brickbreaker', 'minesweeper', 'cardgames'], files: MAHJONG_SOUNDS },
    jezzball: { dirs: ['jezzball'] }
};

function featureManifest() {
    const src = fs.readFileSync(path.join(PUBLIC, 'scripts/comp/featureLoader.js'), 'utf8');
    const start = src.indexOf('const FEATURE_MANIFEST = {');
    const end = src.indexOf('\n};', start);
    if (start < 0 || end < 0) throw new Error('FEATURE_MANIFEST not found in featureLoader.js');
    const box = {};
    vm.runInNewContext(src.slice(start, end + 3).replace('const FEATURE_MANIFEST', 'out'), box);
    return box.out;
}

function featureFiles(manifest, name, seen = new Set()) {
    if (seen.has(name)) return [];
    seen.add(name);
    const f = manifest[name];
    if (!f) throw new Error('unknown feature ' + name);
    const out = [];
    (f.depends || []).forEach((dep) => out.push(...featureFiles(manifest, dep, seen)));
    (f.styles || []).concat(f.scripts || []).forEach((p) => out.push('/' + p.replace(/^\//, '')));
    return out;
}

function walk(webDir) {
    const abs = path.join(PUBLIC, webDir);
    if (!fs.existsSync(abs)) return [];
    const out = [];
    fs.readdirSync(abs, { withFileTypes: true }).forEach((d) => {
        const web = webDir.replace(/\/$/, '') + '/' + d.name;
        if (d.isDirectory()) {
            // the 2x copies and the media folder itself stay out
            if (d.name === 'sheets2x' || d.name === 'media') return;
            out.push(...walk(web));
        } else if (!/@2x\.|x2\.png$/i.test(d.name)) {
            out.push(web);
        }
    });
    return out;
}

function urlsFor(id, manifest) {
    const g = GAMES[id];
    const urls = new Set(featureFiles(manifest, 'vista_' + id));
    g.dirs.map((d) => ART + d).concat(COMMON).forEach((d) => walk(d).forEach((u) => urls.add(u)));
    (g.files || []).forEach((u) => urls.add(u));
    return Array.from(urls).sort();
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// a lighter copy of art or sound, same format (the url keeps its type), or null
const liteCache = new Map();
async function lite(url, data) {
    if (liteCache.has(url)) return liteCache.get(url);
    const ext = path.extname(url).toLowerCase();
    let out = null;
    try {
        if (ext === '.webp') out = await sharp(Buffer.from(data)).webp({ quality: 70, alphaQuality: 80, effort: 6 }).toBuffer();
        else if (ext === '.png') out = await sharp(Buffer.from(data)).png({ palette: true, quality: 80, effort: 10, compressionLevel: 9 }).toBuffer();
        else if (ext === '.m4a' || ext === '.opus') {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-media-'));
            const src = path.join(tmp, 'in' + ext);
            const dst = path.join(tmp, 'out' + ext);
            fs.writeFileSync(src, data);
            const codec = ext === '.opus' ? ['-c:a', 'libopus', '-b:a', '40k'] : ['-c:a', 'aac', '-b:a', '48k'];
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', ...codec, dst]);
            out = fs.readFileSync(dst);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    } catch (err) {
        console.warn('lite copy failed for ' + url + ': ' + err.message);
        out = null;
    }
    // worth it only when it saves a tenth
    const result = out && out.byteLength < data.byteLength * 0.9 ? new Uint8Array(out) : null;
    liteCache.set(url, result);
    return result;
}

async function build(id, manifest) {
    const urls = urlsFor(id, manifest);
    const entries = {};
    const files = [];
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const abs = path.join(PUBLIC, url);
        if (!fs.existsSync(abs)) throw new Error(id + ': missing ' + url);
        const data = new Uint8Array(fs.readFileSync(abs));
        const entry = 'f/' + String(i).padStart(4, '0');
        const row = { entry, url, hash: sha256(data), size: data.byteLength };
        const small = await lite(url, data);
        if (small) row.lite = { hash: sha256(small), size: small.byteLength };
        // art and audio are compressed already; text deflates
        const level = /\.(js|css|json|html|svg|bin)$/i.test(url) ? 6 : 0;
        entries[entry] = [small || data, { level }];
        files.push(row);
    }
    const listing = JSON.stringify({ game: id, files });
    entries['pack.json'] = [fflate.strToU8(listing), { level: 6 }];
    const mtime = new Date('2026-10-21T00:00:00Z');
    const zip = fflate.zipSync(entries, { mtime });
    // the full files behind the lighter copies, for Setup's last step
    const full = { 'pack.json': [fflate.strToU8(JSON.stringify({ game: id, full: true, files: files.filter((f) => f.lite) })), { level: 6 }] };
    files.filter((f) => f.lite).forEach((f) => { full[f.entry] = [new Uint8Array(fs.readFileSync(path.join(PUBLIC, f.url))), { level: 0 }]; });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, id + '.zip'), zip);
    fs.writeFileSync(path.join(OUT, id + '.full.zip'), fflate.zipSync(full, { mtime }));
    fs.writeFileSync(path.join(OUT, id + '.json'), listing);
    return { id, files: files.length, lite: files.filter((f) => f.lite).length, bytes: zip.byteLength };
}

if (require.main === module) {
    const onlyArg = process.argv.indexOf('--only');
    const only = onlyArg > 0 ? process.argv[onlyArg + 1].split(',') : Object.keys(GAMES);
    const manifest = featureManifest();
    (async () => {
        for (const id of only) {
            const r = await build(id, manifest);
            console.log(`${r.id}.zip  ${r.files} files (${r.lite} lighter)  ${(r.bytes / 1048576).toFixed(2)} MB`);
        }
    })().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { GAMES, featureManifest, urlsFor };
