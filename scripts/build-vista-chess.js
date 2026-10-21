#!/usr/bin/env node
/**
 * Build Chess Titans' 3D assets (Yozora #609) from the resources of Chess.dll, dumped on the Vista
 * VM with C:\agent\dumpres.exe into ~/.cache/vista-vm/games/Chess (DATA_<PATH>.bin). The sprite
 * packs scripts/build-vista-games.js makes do not cover this game: Chess Titans is a Direct3D 9
 * game of its own, so this converts what its renderer loads:
 *
 *   Media\MeshesHigh|MeshesLow\<piece>.x   binary DirectX .X meshes (xof 0303bin 0032)
 *       -> chess/meshes-high.bin, meshes-low.bin: per mesh int16 positions (x 1/1024), int8 normals,
 *          uint16 uvs (x 1/65535 over the mesh's uv box) and uint16 triangle indices (see the
 *          header in the file; public/scripts/comp/desktop-apps/vista-games/chessRender.js reads it)
 *   Media\*.dds (cabinets: one file each)  A8R8G8B8 2D textures and DXT1 cube maps (environments)
 *       -> chess/textures/<name>.webp (colour) / .png (decals with alpha), environments as six faces
 *          chess/textures/env-<name>-<face>.webp (+x -x +y -y +z -z, the DDS order)
 *   Media\Animations\<n>By<m>.can          the piece move curves (frame count, quaternions, positions)
 *       -> chess/data3d.json { anims }
 *   Media\Chess.opn                        the opening book (69311 lines of 14 plies, "e2e4e7e5...")
 *       -> chess/book.bin: the book as a move tree in preorder, lines played at least twice
 *   Media\Sound\*.wav                      -> chess/audio/<name>.m4a
 *
 *   node scripts/build-vista-chess.js [--src ~/.cache/vista-vm/games/Chess]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/static_images/vista-games/chess');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SRC = argValue('--src', path.join(os.homedir(), '.cache/vista-vm/games/Chess'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vista-chess-'));

// ---- binary .X ---------------------------------------------------------------------------
// Token stream (DirectX "binary format": WORD token, NAME/STRING with a DWORD length, INTEGER_LIST /
// FLOAT_LIST with a DWORD count). Templates are skipped; each data object becomes
// { type, name, data: [numbers / strings in order], children }.
function parseX(buf) {
    const hdr = buf.toString('latin1', 0, 16);
    if (!/^xof 03\d\dbin/.test(hdr)) throw new Error('not a binary .X file: ' + hdr);
    const fsz = hdr.slice(12, 16) === '0064' ? 8 : 4;
    let p = 16;
    const toks = [];
    while (p < buf.length) {
        const t = buf.readUInt16LE(p);
        p += 2;
        if (t === 1) {
            const n = buf.readUInt32LE(p);
            toks.push({ t: 'name', v: buf.toString('latin1', p + 4, p + 4 + n) });
            p += 4 + n;
        } else if (t === 2) {
            const n = buf.readUInt32LE(p);
            toks.push({ t: 'string', v: buf.toString('latin1', p + 4, p + 4 + n) });
            p += 4 + n + 2; // and its terminator token
        } else if (t === 3) {
            toks.push({ t: 'int', v: buf.readUInt32LE(p) });
            p += 4;
        } else if (t === 5) {
            toks.push({ t: 'guid' });
            p += 16;
        } else if (t === 6) {
            const n = buf.readUInt32LE(p);
            const a = new Array(n);
            for (let i = 0; i < n; i++) a[i] = buf.readUInt32LE(p + 4 + i * 4);
            toks.push({ t: 'list', v: a });
            p += 4 + n * 4;
        } else if (t === 7) {
            const n = buf.readUInt32LE(p);
            const a = new Array(n);
            for (let i = 0; i < n; i++) a[i] = fsz === 4 ? buf.readFloatLE(p + 4 + i * 4) : buf.readDoubleLE(p + 4 + i * 8);
            toks.push({ t: 'list', v: a });
            p += 4 + n * fsz;
        } else toks.push({ t: 'sym', v: t });
    }
    let i = 0;
    const isSym = (k, v) => k && k.t === 'sym' && k.v === v;
    const readObject = () => {
        const obj = { type: toks[i++].v, name: '', data: [], children: [] };
        if (toks[i].t === 'name') obj.name = toks[i++].v;
        if (toks[i].t === 'guid') i++;
        if (!isSym(toks[i], 0x0a)) throw new Error('.X: expected { after ' + obj.type);
        i++;
        while (i < toks.length) {
            const k = toks[i];
            if (isSym(k, 0x0b)) {
                i++;
                return obj;
            }
            const next = toks[i + 1];
            if (k.t === 'name' && next && (next.t === 'name' || next.t === 'guid' || isSym(next, 0x0a))) {
                obj.children.push(readObject());
                continue;
            }
            if (k.t === 'list') for (const v of k.v) obj.data.push(v);
            else if (k.t === 'int' || k.t === 'string') obj.data.push(k.v);
            i++;
        }
        return obj;
    };
    const roots = [];
    while (i < toks.length) {
        const k = toks[i];
        if (isSym(k, 0x1f)) { // template: skip to its closing brace
            let depth = 0;
            for (i++; i < toks.length; i++) {
                if (isSym(toks[i], 0x0a)) depth++;
                if (isSym(toks[i], 0x0b) && --depth === 0) { i++; break; }
            }
            continue;
        }
        if (k.t === 'name') roots.push(readObject());
        else i++;
    }
    return roots;
}

// Mesh object -> flat triangle mesh (positions, normals, uvs per vertex; faces fanned)
function meshFromX(roots) {
    const mesh = roots.find((r) => r.type === 'Mesh');
    const d = mesh.data;
    const nv = d[0];
    const pos = d.slice(1, 1 + nv * 3);
    let o = 1 + nv * 3;
    const nf = d[o++];
    const faces = [];
    for (let f = 0; f < nf; f++) {
        const n = d[o++];
        faces.push(d.slice(o, o + n));
        o += n;
    }
    const normalsObj = mesh.children.find((c) => c.type === 'MeshNormals');
    const uvObj = mesh.children.find((c) => c.type === 'MeshTextureCoords');
    let nrm = new Array(nv * 3).fill(0);
    if (normalsObj) {
        const nd = normalsObj.data;
        const nn = nd[0];
        const normals = nd.slice(1, 1 + nn * 3);
        let q = 1 + nn * 3;
        const nfn = nd[q++];
        // face normal indices map each face corner to a normal
        for (let f = 0; f < nfn; f++) {
            const n = nd[q++];
            for (let k = 0; k < n; k++) {
                const vi = faces[f][k];
                const ni = nd[q + k];
                nrm[vi * 3] = normals[ni * 3];
                nrm[vi * 3 + 1] = normals[ni * 3 + 1];
                nrm[vi * 3 + 2] = normals[ni * 3 + 2];
            }
            q += n;
        }
    }
    const uv = uvObj ? uvObj.data.slice(1, 1 + nv * 2) : new Array(nv * 2).fill(0);
    const tris = [];
    faces.forEach((f) => {
        for (let k = 1; k + 1 < f.length; k++) tris.push(f[0], f[k], f[k + 1]);
    });
    return { name: mesh.name, nv, pos, nrm, uv, tris };
}

// meshes -> one file: "CHM1", u32 count, then per mesh (every section padded to 4 bytes): u8 nameLen +
// name, u32 nv, u32 ni, f32 posScale, f32 uvMin[2], f32 uvMax[2], int16 pos[nv*3] (x posScale),
// int8 nrm[nv*4] (x y z pad, x 1/127), uint16 uv[nv*2] (over uvMin..uvMax), uint16 idx[ni]
function packMeshes(list) {
    const parts = [];
    const head = Buffer.alloc(8);
    head.write('CHM1', 0, 'latin1');
    head.writeUInt32LE(list.length, 4);
    parts.push(head);
    list.forEach(({ key, mesh }) => {
        const maxAbs = mesh.pos.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6);
        const posScale = maxAbs / 32767;
        let u0 = Infinity; let v0 = Infinity; let u1 = -Infinity; let v1 = -Infinity;
        for (let i = 0; i < mesh.nv; i++) {
            u0 = Math.min(u0, mesh.uv[i * 2]); u1 = Math.max(u1, mesh.uv[i * 2]);
            v0 = Math.min(v0, mesh.uv[i * 2 + 1]); v1 = Math.max(v1, mesh.uv[i * 2 + 1]);
        }
        if (u1 - u0 < 1e-6) u1 = u0 + 1;
        if (v1 - v0 < 1e-6) v1 = v0 + 1;
        const name = Buffer.from(key, 'latin1');
        const h = Buffer.alloc((name.length + 4) & ~3);
        h.writeUInt8(name.length, 0);
        name.copy(h, 1);
        parts.push(h);
        const meta = Buffer.alloc(4 * 7);
        meta.writeUInt32LE(mesh.nv, 0);
        meta.writeUInt32LE(mesh.tris.length, 4);
        meta.writeFloatLE(posScale, 8);
        meta.writeFloatLE(u0, 12); meta.writeFloatLE(v0, 16); meta.writeFloatLE(u1, 20); meta.writeFloatLE(v1, 24);
        parts.push(meta);
        const P = Buffer.alloc(mesh.nv * 6 + ((mesh.nv * 6) % 4 ? 2 : 0));
        for (let i = 0; i < mesh.nv * 3; i++) P.writeInt16LE(Math.round(mesh.pos[i] / posScale), i * 2);
        parts.push(P);
        const N = Buffer.alloc(mesh.nv * 4);
        for (let i = 0; i < mesh.nv; i++) {
            let x = mesh.nrm[i * 3]; let y = mesh.nrm[i * 3 + 1]; let z = mesh.nrm[i * 3 + 2];
            const l = Math.hypot(x, y, z) || 1;
            x /= l; y /= l; z /= l;
            N.writeInt8(Math.round(x * 127), i * 4); N.writeInt8(Math.round(y * 127), i * 4 + 1); N.writeInt8(Math.round(z * 127), i * 4 + 2);
        }
        parts.push(N);
        const U = Buffer.alloc(mesh.nv * 4);
        for (let i = 0; i < mesh.nv; i++) {
            U.writeUInt16LE(Math.round((mesh.uv[i * 2] - u0) / (u1 - u0) * 65535), i * 4);
            U.writeUInt16LE(Math.round((mesh.uv[i * 2 + 1] - v0) / (v1 - v0) * 65535), i * 4 + 2);
        }
        parts.push(U);
        const I = Buffer.alloc(mesh.tris.length * 2 + ((mesh.tris.length * 2) % 4 ? 2 : 0));
        mesh.tris.forEach((v, i) => I.writeUInt16LE(v, i * 2));
        parts.push(I);
    });
    return Buffer.concat(parts);
}

// ---- DDS ---------------------------------------------------------------------------------
function cabFile(cab) {
    const dir = fs.mkdtempSync(path.join(tmp, 'cab-'));
    execFileSync('7z', ['x', '-y', '-bso0', '-bsp0', '-o' + dir, cab]);
    const f = fs.readdirSync(dir)[0];
    return fs.readFileSync(path.join(dir, f));
}

const rgb565 = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];

function decodeDxt1(buf, off, w, h) {
    const out = Buffer.alloc(w * h * 4);
    let p = off;
    for (let by = 0; by < h; by += 4) {
        for (let bx = 0; bx < w; bx += 4) {
            const c0 = buf.readUInt16LE(p);
            const c1 = buf.readUInt16LE(p + 2);
            const bits = buf.readUInt32LE(p + 4);
            p += 8;
            const a = rgb565(c0);
            const b = rgb565(c1);
            const pal = [a.concat(255), b.concat(255)];
            if (c0 > c1) {
                pal.push(a.map((v, i) => (2 * v + b[i]) / 3).concat(255));
                pal.push(a.map((v, i) => (v + 2 * b[i]) / 3).concat(255));
            } else {
                pal.push(a.map((v, i) => (v + b[i]) / 2).concat(255));
                pal.push([0, 0, 0, 0]);
            }
            for (let k = 0; k < 16; k++) {
                const x = bx + (k & 3);
                const y = by + (k >> 2);
                if (x >= w || y >= h) continue;
                const c = pal[(bits >> (k * 2)) & 3];
                const o = (y * w + x) * 4;
                out[o] = Math.round(c[0]); out[o + 1] = Math.round(c[1]); out[o + 2] = Math.round(c[2]); out[o + 3] = c[3];
            }
        }
    }
    return { rgba: out, size: Math.max(1, w / 4) * Math.max(1, h / 4) * 8 };
}

// -> { w, h, cube, faces: [rgba] } (level 0 of each face)
function decodeDds(buf) {
    if (buf.toString('latin1', 0, 4) !== 'DDS ') throw new Error('not a DDS file');
    const h = buf.readUInt32LE(12);
    const w = buf.readUInt32LE(16);
    const mips = Math.max(1, buf.readUInt32LE(28));
    const pf = buf.readUInt32LE(80);
    const four = buf.toString('latin1', 84, 88);
    const caps2 = buf.readUInt32LE(112);
    const cube = (caps2 & 0x200) !== 0;
    let off = 128;
    const faces = [];
    const nFaces = cube ? 6 : 1;
    for (let f = 0; f < nFaces; f++) {
        let mw = w;
        let mh = h;
        for (let m = 0; m < mips; m++) {
            let rgba;
            let size;
            if (pf & 0x4) {
                if (four !== 'DXT1') throw new Error('unsupported DDS ' + four);
                const r = decodeDxt1(buf, off, mw, mh);
                rgba = r.rgba;
                size = r.size;
            } else {
                // A8R8G8B8 (BGRA in memory)
                size = mw * mh * 4;
                rgba = Buffer.alloc(size);
                for (let i = 0; i < mw * mh; i++) {
                    rgba[i * 4] = buf[off + i * 4 + 2];
                    rgba[i * 4 + 1] = buf[off + i * 4 + 1];
                    rgba[i * 4 + 2] = buf[off + i * 4];
                    rgba[i * 4 + 3] = (pf & 0x1) ? buf[off + i * 4 + 3] : 255;
                }
            }
            if (m === 0) faces.push(rgba);
            off += size;
            mw = Math.max(1, mw >> 1);
            mh = Math.max(1, mh >> 1);
        }
    }
    return { w, h, cube, faces };
}

// texture name -> output: kind 'colour' (webp, opaque), 'alpha' (png), max size
const TEXTURES = {
    BOARDMARBLE: ['colour', 1024], BOARDPORCELAIN: ['colour', 1024], BOARDWOOD: ['colour', 1024],
    BACKMARBLE: ['colour', 1024], BACKPORCELAIN: ['colour', 1024], BACKWOOD: ['colour', 1024],
    TABLEMARBLE: ['colour', 1024], TABLEPORCELAIN: ['colour', 1024], TABLEWOOD: ['colour', 1024],
    GLASSDARK: ['colour', 1024], GLASSLIGHT: ['colour', 1024], WOODDARK: ['colour', 1024], WOODLIGHT: ['colour', 1024],
    CHESSTRIM: ['alpha', 4], GRADIENT: ['alpha', 256], DECALS_FLAT: ['alpha', 512],
    DECALS_ACTION: ['alpha', 256], DECALS_CHECK: ['alpha', 128], DECALS_LASTMOVESOURCE: ['alpha', 128],
    DECALS_LASTMOVETARGET: ['alpha', 128], DECALS_SELECT: ['alpha', 256], DECALS_SHADOW: ['alpha', 128],
    DECALS_THINKY0: ['alpha', 256], DECALS_THINKY1: ['alpha', 256], DECALS_THINKY2: ['alpha', 256],
    DECALS_THINKY3: ['alpha', 256], DECALS_THINKY4: ['alpha', 256], DECALS_THINKY5: ['alpha', 256],
    DECALS_TIPBLUETOP: ['alpha', 512], DECALS_TIPBLUEMIDDLE: ['alpha', 512], DECALS_TIPBLUEBOTTOM: ['alpha', 512],
    DECALS_TIPREDTOP: ['alpha', 512], DECALS_TIPREDMIDDLE: ['alpha', 512], DECALS_TIPREDBOTTOM: ['alpha', 512],
    DECALS_TIPMISC: ['alpha', 128],
    ENVIRONMENTS_AURORA: ['cube', 1024], ENVIRONMENTS_STARS: ['cube', 1024], ENVIRONMENTS_CHECKER: ['cube', 256], ENVIRONMENTS_FROSTED: ['cube', 256]
};
const CUBE_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

async function buildTextures() {
    const dir = path.join(OUT, 'textures');
    fs.mkdirSync(dir, { recursive: true });
    const index = {};
    for (const [name, [kind]] of Object.entries(TEXTURES)) {
        const file = path.join(SRC, 'DATA_MEDIA_' + name + '.DDS.CAB.bin');
        if (!fs.existsSync(file)) {
            console.warn('missing', file);
            continue;
        }
        const dds = decodeDds(cabFile(file));
        const base = name.toLowerCase().replace(/^decals_/, 'decal-').replace(/^environments_/, 'env-');
        const raw = { raw: { width: dds.w, height: dds.h, channels: 4 } };
        if (kind === 'cube') {
            for (let f = 0; f < 6; f++) {
                await sharp(dds.faces[f], raw).removeAlpha().webp({ quality: 88 }).toFile(path.join(dir, base + '-' + CUBE_FACES[f] + '.webp'));
            }
            index[base] = { cube: true, size: dds.w };
        } else if (kind === 'colour') {
            await sharp(dds.faces[0], raw).removeAlpha().webp({ quality: 90 }).toFile(path.join(dir, base + '.webp'));
            index[base] = { file: base + '.webp', w: dds.w, h: dds.h };
        } else {
            await sharp(dds.faces[0], raw).png({ compressionLevel: 9 }).toFile(path.join(dir, base + '.png'));
            index[base] = { file: base + '.png', w: dds.w, h: dds.h };
        }
        console.log('texture', base, dds.w + 'x' + dds.h, kind);
    }
    return index;
}

// ---- meshes ------------------------------------------------------------------------------
const MESHES = ['KING', 'QUEEN', 'BISHOP', 'KNIGHT', 'ROOK', 'PAWN', 'CHESSBOARD', 'CHESSTABLE', 'CHESSTRIM'];

function buildMeshes() {
    const bounds = {};
    ['HIGH', 'LOW'].forEach((q) => {
        const list = MESHES.map((m) => {
            const mesh = meshFromX(parseX(fs.readFileSync(path.join(SRC, 'DATA_MEDIA_MESHES' + q + '_' + m + '.X.bin'))));
            const ys = [];
            for (let i = 1; i < mesh.pos.length; i += 3) ys.push(mesh.pos[i]);
            bounds[q.toLowerCase() + ':' + m.toLowerCase()] = { verts: mesh.nv, tris: mesh.tris.length / 3, minY: Math.min(...ys), maxY: Math.max(...ys) };
            return { key: m.toLowerCase(), mesh };
        });
        fs.writeFileSync(path.join(OUT, 'meshes-' + q.toLowerCase() + '.bin'), packMeshes(list));
    });
    return bounds;
}

// ---- move animations (.can): "<n>\r\n" then n quaternions "w,x,y,z" then n positions "x,y,z"
function buildAnims() {
    const anims = {};
    fs.readdirSync(SRC).filter((f) => /^DATA_MEDIA_ANIMATIONS_.*\.CAN\.bin$/.test(f)).forEach((f) => {
        const name = f.replace(/^DATA_MEDIA_ANIMATIONS_/, '').replace(/\.CAN\.bin$/, '').toLowerCase();
        const lines = fs.readFileSync(path.join(SRC, f), 'latin1').split(/\r?\n/).filter((l) => l.trim());
        const n = parseInt(lines[0], 10);
        const round = (v) => Math.round(parseFloat(v) * 1e6) / 1e6;
        const rot = lines.slice(1, 1 + n).map((l) => l.split(',').map(round));
        const pos = lines.slice(1 + n, 1 + 2 * n).map((l) => l.split(',').map(round));
        anims[name] = { n, rot, pos };
    });
    return anims;
}

// ---- opening book --------------------------------------------------------------------------
// Tree in preorder: per node u16 = from | to << 6 | hasChildren << 12 | lastSibling << 13, then a
// varint weight (lines through the node). The root's children are the first moves.
function buildBook() {
    const lines = fs.readFileSync(path.join(SRC, 'DATA_MEDIA_CHESS.OPN.bin'), 'latin1').split(/\r?\n/).filter(Boolean);
    const sq = (s) => (s.charCodeAt(0) - 97) + (s.charCodeAt(1) - 49) * 8;
    const root = { kids: new Map(), w: 0 };
    lines.forEach((l) => {
        let node = root;
        for (let i = 0; i + 4 <= l.length; i += 4) {
            const mv = sq(l.slice(i, i + 2)) | (sq(l.slice(i + 2, i + 4)) << 6);
            if (!node.kids.has(mv)) node.kids.set(mv, { kids: new Map(), w: 0 });
            node = node.kids.get(mv);
            node.w++;
        }
    });
    const bytes = [];
    const varint = (v) => {
        while (v >= 0x80) {
            bytes.push((v & 0x7f) | 0x80);
            v >>>= 7;
        }
        bytes.push(v);
    };
    let nodes = 0;
    const walk = (node) => {
        const kids = [...node.kids.entries()].filter(([, k]) => k.w >= 2).sort((a, b) => b[1].w - a[1].w);
        kids.forEach(([mv, k], i) => {
            const grand = [...k.kids.values()].some((g) => g.w >= 2);
            const v = mv | (grand ? 1 << 12 : 0) | (i === kids.length - 1 ? 1 << 13 : 0);
            bytes.push(v & 255, v >> 8);
            varint(k.w);
            nodes++;
            if (grand) walk(k);
        });
    };
    walk(root);
    fs.writeFileSync(path.join(OUT, 'book.bin'), Buffer.from(bytes));
    return { lines: lines.length, nodes, bytes: bytes.length };
}

// ---- sounds --------------------------------------------------------------------------------
function buildSounds() {
    const dir = path.join(OUT, 'audio');
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    fs.readdirSync(SRC).filter((f) => /^DATA_MEDIA_SOUND_.*\.WAV\.bin$/.test(f)).forEach((f) => {
        const name = f.replace(/^DATA_MEDIA_SOUND_/, '').replace(/\.WAV\.bin$/, '').toLowerCase().replace(/^chess_/, '');
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(SRC, f), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', path.join(dir, name + '.m4a')]);
        out.push(name);
    });
    return out;
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const meshes = buildMeshes();
    const anims = buildAnims();
    const book = buildBook();
    const sounds = buildSounds();
    const textures = await buildTextures();
    fs.writeFileSync(path.join(OUT, 'data3d.json'), JSON.stringify({ meshes, anims, textures, sounds, book }));
    console.log('meshes', JSON.stringify(meshes));
    console.log('book', JSON.stringify(book));
    console.log('sounds', sounds.join(' '));
    fs.rmSync(tmp, { recursive: true, force: true });
})().catch((err) => {
    console.error(err);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
});
