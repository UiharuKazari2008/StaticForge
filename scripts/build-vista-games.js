#!/usr/bin/env node
/**
 * Build the Vista games' web assets (Yozora #609) from the resources of the games themselves,
 * dumped on the Vista VM with C:\agent\dumpres.exe (one folder per resource file, files named
 * <TYPE>_<NAME>.bin):
 *
 *   Minesweeper  <- Minesweeper\MineSweeper.dll        Mahjong      <- Mahjong\Mahjong.dll
 *   CardGames    <- System32\CardGames.dll (the decks, backgrounds and sounds Solitaire,
 *                   Spider Solitaire, FreeCell and Hearts share)
 *   PurblePlace  <- Purble Place\PurblePlace.dll + PurblePlace2.dll (one folder here)
 *   Chess        <- Chess\Chess.dll                     inkball      <- inkball\inkball.exe
 *   mui/<Game>   <- <Game>\en-US\<Game>.exe.mui (string tables, menus, dialogs, accelerators)
 *   gameux       <- System32\gameux.dll(.mui) (Games Explorer)
 *
 * The sprite engine those games share stores a sheet as a D3DX JPEG (colour) plus a cabinet
 * holding an 8-bit BMP (alpha). <name>X2 is the 2x (high DPI) sheet; a large 2x sheet is split
 * into quadrant pages X21 (top left, 1024 px) X22 (top right) X23 (bottom left) X24 (bottom
 * right). This build joins colour and alpha (and the quadrants) into one WebP per sheet and DPI:
 *
 *   public/static_images/vista-games/<game>/sheets/<sheet>.webp     1x
 *   public/static_images/vista-games/<game>/sheets/<sheet>@2x.webp  2x
 *   public/static_images/vista-games/<game>/audio/<sound>.m4a       WMA -> AAC
 *   public/static_images/vista-games/<game>/images/<name>.png       PNG resources as they are
 *   public/static_images/vista-games/<game>/data.json
 *
 * data.json: { sheets: { KEY: [w, h, w2x, h2x] }, xml: { KEY: node }, audio: [KEY], images: [KEY],
 * mui: { strings: { id: text }, menus: { id: [...] }, dialogs: { id: {...} } } }. KEY is the
 * resource path upper-cased with every separator as "_", which is how the engine's own paths
 * ("UI\Blue_Flag.xml", "Sheets\blueSheet1.sht") look up too (vistaGameKey in the runtime). A node
 * is { t: tag, a: attributes, c: children, v: text }; localisable text "|id|cat|Text//note" keeps
 * only Text.
 *
 *   node scripts/build-vista-games.js [--src ~/.cache/vista-vm/games] [--only Minesweeper,CardGames]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'public/static_images/vista-games');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SRC = argValue('--src', path.join(os.homedir(), '.cache/vista-vm/games'));
const ONLY = (argValue('--only', '') || '').split(',').filter(Boolean);

// dump folder(s) -> output folder, MUI folder
const GAMES = [
    { out: 'minesweeper', dirs: ['Minesweeper'], mui: 'Minesweeper' },
    { out: 'cardgames', dirs: ['CardGames'], mui: null },
    { out: 'solitaire', dirs: [], mui: 'Solitaire' },
    { out: 'spider', dirs: [], mui: 'SpiderSolitaire' },
    { out: 'freecell', dirs: [], mui: 'FreeCell' },
    { out: 'hearts', dirs: [], mui: 'Hearts' },
    { out: 'mahjong', dirs: ['Mahjong'], mui: 'Mahjong' },
    { out: 'purble', dirs: ['PurblePlace', 'PurblePlace2'], mui: 'PurblePlace' },
    { out: 'chess', dirs: ['Chess'], mui: 'Chess' },
    { out: 'inkball', dirs: ['inkball'], mui: 'inkball' },
    { out: 'gameux', dirs: ['gameux/dll'], mui: 'gameux/mui', muiRoot: true }
];

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vista-games-'));

const keyOf = (name) => name.replace(/^DATA_/, '').replace(/\.bin$/, '').replace(/\.(png)$/i, '').toUpperCase();

// ---- XML -> node -------------------------------------------------------------------------
const decodeEntities = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
// "|55713|CONFIG|Silver and Blue//Silver and Blue config name" -> "Silver and Blue"
const localText = (s) => {
    const m = /^\|\d+\|[^|]*\|([\s\S]*?)(?:\/\/[\s\S]*)?$/.exec(s);
    return m ? m[1].trim() : s;
};
function parseXml(text) {
    text = text.replace(/^\uFEFF/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const root = { t: '#doc', c: [] };
    const stack = [root];
    const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(text))) {
        const top = stack[stack.length - 1];
        if (m[5] !== undefined) {
            const v = m[5].trim();
            if (v) top.v = (top.v || '') + localText(decodeEntities(v));
            continue;
        }
        if (m[1]) { stack.pop(); continue; }
        const node = { t: m[2] };
        const attrRe = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = attrRe.exec(m[3]))) {
            node.a = node.a || {};
            node.a[a[1]] = localText(decodeEntities(a[2] !== undefined ? a[2] : a[3]));
        }
        (top.c = top.c || []).push(node);
        if (!m[4]) stack.push(node);
    }
    return root.c && root.c.length === 1 ? root.c[0] : root;
}

// ---- MUI resources (string tables, menus, dialogs) --------------------------------------
function readSz(buf, off) {
    let s = '';
    while (off + 1 < buf.length) {
        const ch = buf.readUInt16LE(off);
        off += 2;
        if (!ch) break;
        s += String.fromCharCode(ch);
    }
    return [s, off];
}
// sz_Or_Ord: 0x0000 = none, 0xFFFF + ordinal, else a string
function readSzOrOrd(buf, off) {
    const first = buf.readUInt16LE(off);
    if (first === 0) return [null, off + 2];
    if (first === 0xffff) return [buf.readUInt16LE(off + 2), off + 4];
    return readSz(buf, off);
}
const align4 = (n) => (n + 3) & ~3;

function parseStrings(buf, blockId, out) {
    let off = 0;
    for (let i = 0; i < 16 && off + 1 < buf.length; i++) {
        const len = buf.readUInt16LE(off);
        off += 2;
        if (len) out[(blockId - 1) * 16 + i] = buf.toString('utf16le', off, off + len * 2);
        off += len * 2;
    }
}

function parseMenu(buf) {
    const version = buf.readUInt16LE(0);
    if (version === 1) {
        // MENUEX: version, offset, helpId, then MENUEX_TEMPLATE_ITEMs (DWORD aligned)
        let off = 4 + buf.readUInt16LE(2);
        const readItems = () => {
            const items = [];
            for (;;) {
                off = align4(off);
                if (off + 14 > buf.length) break;
                const type = buf.readUInt32LE(off);
                const state = buf.readUInt32LE(off + 4);
                const id = buf.readUInt32LE(off + 8);
                const flags = buf.readUInt16LE(off + 12);
                let text;
                [text, off] = readSz(buf, off + 14);
                const item = { id, text };
                if (type & 0x800) item.separator = true;
                if (type & 0x200) item.radio = true;
                if (state & 0x8) item.checked = true;
                if (state & 0x3) item.disabled = true;
                if (flags & 0x01) {
                    off = align4(off) + 4; // dwHelpId
                    item.items = readItems();
                }
                items.push(item);
                if (flags & 0x80) break;
            }
            return items;
        };
        return readItems();
    }
    let off = 4;
    const readItems = () => {
        const items = [];
        for (;;) {
            if (off + 2 > buf.length) break;
            const flags = buf.readUInt16LE(off);
            off += 2;
            const item = {};
            if (!(flags & 0x10)) { item.id = buf.readUInt16LE(off); off += 2; }
            [item.text, off] = readSz(buf, off);
            if (flags & 0x800 || (!item.text && !(flags & 0x10) && !item.id)) item.separator = true;
            if (flags & 0x8) item.checked = true;
            if (flags & 0x3) item.disabled = true;
            if (flags & 0x10) item.items = readItems();
            items.push(item);
            if (flags & 0x80) break;
        }
        return items;
    };
    return readItems();
}

const CONTROL_CLASSES = { 0x80: 'Button', 0x81: 'Edit', 0x82: 'Static', 0x83: 'ListBox', 0x84: 'ScrollBar', 0x85: 'ComboBox' };
function parseDialog(buf) {
    const ex = buf.readUInt16LE(0) === 1 && buf.readUInt16LE(2) === 0xffff;
    let off;
    const dlg = { ex };
    let count;
    if (ex) {
        dlg.helpId = buf.readUInt32LE(4);
        dlg.exStyle = buf.readUInt32LE(8);
        dlg.style = buf.readUInt32LE(12);
        count = buf.readUInt16LE(16);
        dlg.x = buf.readInt16LE(18); dlg.y = buf.readInt16LE(20);
        dlg.cx = buf.readInt16LE(22); dlg.cy = buf.readInt16LE(24);
        off = 26;
    } else {
        dlg.style = buf.readUInt32LE(0);
        dlg.exStyle = buf.readUInt32LE(4);
        count = buf.readUInt16LE(8);
        dlg.x = buf.readInt16LE(10); dlg.y = buf.readInt16LE(12);
        dlg.cx = buf.readInt16LE(14); dlg.cy = buf.readInt16LE(16);
        off = 18;
    }
    [dlg.menu, off] = readSzOrOrd(buf, off);
    [dlg.className, off] = readSzOrOrd(buf, off);
    [dlg.title, off] = readSz(buf, off);
    if (dlg.style & 0x40) { // DS_SETFONT
        dlg.fontSize = buf.readUInt16LE(off);
        off += 2;
        if (ex) {
            dlg.fontWeight = buf.readUInt16LE(off);
            dlg.fontItalic = buf.readUInt8(off + 2);
            off += 4;
        }
        [dlg.font, off] = readSz(buf, off);
    }
    dlg.controls = [];
    for (let i = 0; i < count; i++) {
        off = align4(off);
        const c = {};
        if (ex) {
            c.helpId = buf.readUInt32LE(off);
            c.exStyle = buf.readUInt32LE(off + 4);
            c.style = buf.readUInt32LE(off + 8);
            c.x = buf.readInt16LE(off + 12); c.y = buf.readInt16LE(off + 14);
            c.cx = buf.readInt16LE(off + 16); c.cy = buf.readInt16LE(off + 18);
            c.id = buf.readInt32LE(off + 20);
            off += 24;
        } else {
            c.style = buf.readUInt32LE(off);
            c.exStyle = buf.readUInt32LE(off + 4);
            c.x = buf.readInt16LE(off + 8); c.y = buf.readInt16LE(off + 10);
            c.cx = buf.readInt16LE(off + 12); c.cy = buf.readInt16LE(off + 14);
            c.id = buf.readUInt16LE(off + 16);
            off += 18;
        }
        let cls;
        [cls, off] = readSzOrOrd(buf, off);
        c.className = typeof cls === 'number' ? (CONTROL_CLASSES[cls] || cls) : cls;
        let title;
        [title, off] = readSzOrOrd(buf, off);
        c.text = title;
        const extra = buf.readUInt16LE(off);
        off += 2 + extra;
        dlg.controls.push(c);
    }
    return dlg;
}

function parseAccelerators(buf) {
    const out = [];
    for (let off = 0; off + 8 <= buf.length; off += 8) {
        const flags = buf.readUInt16LE(off);
        out.push({ flags, key: buf.readUInt16LE(off + 2), id: buf.readUInt16LE(off + 4) });
        if (flags & 0x80) break;
    }
    return out;
}

function buildMui(dir) {
    const mui = { strings: {}, menus: {}, dialogs: {}, accelerators: {} };
    if (!fs.existsSync(dir)) return mui;
    for (const name of fs.readdirSync(dir).sort()) {
        const m = /^(\d+)_(.+)\.bin$/.exec(name);
        if (!m) continue;
        const type = Number(m[1]);
        const buf = fs.readFileSync(path.join(dir, name));
        try {
            if (type === 6) parseStrings(buf, Number(m[2]), mui.strings);
            else if (type === 4) mui.menus[m[2]] = parseMenu(buf);
            else if (type === 5) mui.dialogs[m[2]] = parseDialog(buf);
            else if (type === 9) mui.accelerators[m[2]] = parseAccelerators(buf);
        } catch (err) {
            console.warn(`  mui ${name}: ${err.message}`);
        }
    }
    const gdf = path.join(dir, 'DATA___GDF_XML.bin');
    if (fs.existsSync(gdf)) mui.gdf = parseXml(fs.readFileSync(gdf).toString('utf16le').includes('<') ? fs.readFileSync(gdf).toString('utf16le') : fs.readFileSync(gdf, 'utf8'));
    return mui;
}

// ---- sheets --------------------------------------------------------------------------------
function extractCab(cabPath) {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'cab-'));
    execFileSync('7z', ['x', '-y', `-o${dir}`, cabPath], { stdio: 'ignore' });
    const files = fs.readdirSync(dir);
    return path.join(dir, files[0]);
}

// colour JPEG + alpha BMP (cab) -> raw RGBA
async function loadSheetPage(dir, base) {
    const jpg = path.join(dir, `DATA_${base}.JPG.bin`);
    const cab = path.join(dir, `DATA_${base}.BMP.CAB.bin`);
    if (!fs.existsSync(jpg)) return null;
    const colour = await sharp(jpg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = colour.info;
    const rgba = Buffer.alloc(width * height * 4, 255);
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
        rgba[i * 4] = colour.data[j];
        rgba[i * 4 + 1] = colour.data[j + 1];
        rgba[i * 4 + 2] = colour.data[j + 2];
    }
    if (fs.existsSync(cab)) {
        const bmp = extractCab(cab);
        const alpha = await sharp(await bmpToPng(bmp)).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer();
        const channels = alpha.length / (width * height);
        for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = alpha[i * channels];
    }
    return { width, height, rgba };
}

// sharp reads BMP only through ImageMagick-less builds sometimes; convert with ImageMagick
async function bmpToPng(bmpPath) {
    const out = bmpPath.replace(/\.bmp$/i, '') + '.png';
    execFileSync('convert', [bmpPath, '-alpha', 'off', '-colorspace', 'gray', `PNG8:${out}`], { stdio: 'ignore' });
    return out;
}

async function writeWebp(page, outPath) {
    await sharp(page.rgba, { raw: { width: page.width, height: page.height, channels: 4 } })
        .webp({ quality: 92, alphaQuality: 100, effort: 5, smartSubsample: true })
        .toFile(outPath);
}

async function buildSheets(dir, outDir, data) {
    const bases = new Set();
    for (const name of fs.readdirSync(dir)) {
        const m = /^DATA_(.+)\.JPG\.bin$/.exec(name);
        if (m) bases.add(m[1]);
    }
    fs.mkdirSync(path.join(outDir, 'sheets'), { recursive: true });
    const roots = [...bases].filter((b) => !/X2\d?$/.test(b) || !bases.has(b.replace(/X2\d?$/, '')));
    for (const base of roots.sort()) {
        const key = base; // SHEETS_BLUESHEET1
        const file = base.replace(/^SHEETS_/, '').toLowerCase();
        const one = await loadSheetPage(dir, base);
        if (!one) continue;
        await writeWebp(one, path.join(outDir, 'sheets', `${file}.webp`));
        const entry = [one.width, one.height];
        let two = null;
        if (bases.has(`${base}X2`)) {
            two = await loadSheetPage(dir, `${base}X2`);
        } else if (bases.has(`${base}X21`)) {
            const q = [];
            for (let i = 1; i <= 4; i++) q.push(bases.has(`${base}X2${i}`) ? await loadSheetPage(dir, `${base}X2${i}`) : null);
            const w = q[0].width + (q[1] ? q[1].width : 0);
            const h = q[0].height + (q[2] ? q[2].height : 0);
            const rgba = Buffer.alloc(w * h * 4);
            const blit = (p, ox, oy) => {
                if (!p) return;
                for (let y = 0; y < p.height; y++) p.rgba.copy(rgba, ((oy + y) * w + ox) * 4, y * p.width * 4, (y + 1) * p.width * 4);
            };
            blit(q[0], 0, 0);
            blit(q[1], q[0].width, 0);
            blit(q[2], 0, q[0].height);
            blit(q[3], q[0].width, q[0].height);
            two = { width: w, height: h, rgba };
        }
        if (two) {
            await writeWebp(two, path.join(outDir, 'sheets', `${file}@2x.webp`));
            entry.push(two.width, two.height);
        }
        data.sheets[key.replace(/^SHEETS_/, 'SHEETS_') + '.SHT'] = entry;
    }
}

// ---- audio / xml / png ---------------------------------------------------------------------
function buildAudio(dir, outDir, data) {
    const names = fs.readdirSync(dir).filter((n) => /\.WMA\.bin$/.test(n)).sort();
    if (!names.length) return;
    fs.mkdirSync(path.join(outDir, 'audio'), { recursive: true });
    for (const name of names) {
        const key = keyOf(name); // AUDIO_SFX_INVALIDMOVE.WMA
        const file = key.replace(/^AUDIO_(SFX_)?/, '').replace(/\.WMA$/, '').toLowerCase();
        const out = path.join(outDir, 'audio', `${file}.m4a`);
        if (!fs.existsSync(out)) {
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, name), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out]);
        }
        data.audio[key] = file;
    }
}

function buildXml(dir, data) {
    for (const name of fs.readdirSync(dir).sort()) {
        if (!/\.XML\.bin$/.test(name) || name === 'DATA___GDF_XML.bin') continue;
        const raw = fs.readFileSync(path.join(dir, name));
        const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
        try {
            data.xml[keyOf(name)] = parseXml(text);
        } catch (err) {
            console.warn(`  xml ${name}: ${err.message}`);
        }
    }
}

async function buildImages(dir, outDir, data) {
    const names = fs.readdirSync(dir).filter((n) => /\.png$/i.test(n)).sort();
    if (!names.length) return;
    fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
    for (const name of names) {
        const key = keyOf(name).replace(/\.PNG$/, ''); // UI_IMAGES_BLUE_BOARDTHUMB
        const file = key.toLowerCase();
        fs.copyFileSync(path.join(dir, name), path.join(outDir, 'images', `${file}.png`));
        data.images[key + '.PNG'] = file;
    }
}

async function main() {
    if (!fs.existsSync(SRC)) {
        console.error(`no dump at ${SRC} (pass --src)`);
        process.exit(1);
    }
    for (const game of GAMES) {
        if (ONLY.length && !ONLY.includes(game.out)) continue;
        const outDir = path.join(OUT_ROOT, game.out);
        fs.mkdirSync(outDir, { recursive: true });
        const data = { sheets: {}, xml: {}, audio: {}, images: {} };
        for (const d of game.dirs) {
            const dir = path.join(SRC, d);
            if (!fs.existsSync(dir)) continue;
            console.log(`${game.out}: ${d}`);
            await buildSheets(dir, outDir, data);
            buildAudio(dir, outDir, data);
            buildXml(dir, data);
            await buildImages(dir, outDir, data);
        }
        if (game.mui) data.mui = buildMui(path.join(SRC, game.muiRoot ? game.mui : path.join('mui', game.mui)));
        fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(data));
        console.log(`  ${Object.keys(data.sheets).length} sheets, ${Object.keys(data.xml).length} xml, ${Object.keys(data.audio).length} sounds, ${Object.keys(data.images).length} images`);
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        process.exit(1);
    });
} else {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
}

module.exports = { parseXml, parseMenu, parseDialog, parseStrings, localText };
