/**
 * nanami.sora decoder: SoraTan's server half (apps/soratan/server/main.js) runs it on the .sora it
 * finds next to SoraTan.exe, as the exe does (Yozora #633, #638). decodeSora(buffer) returns
 * { scene, png }: the meshes, baked vertex frames and clips the client draws, and the texture.
 * Format notes: docs/soratan.md.
 *
 * nanami.sora, as worked out from the file and SoraTan.exe's loader (S_Archive / S_Serializer):
 *   - chunks of [u32 0x6e39d92b][fourcc][u32 size][data]: CENT (entries), WIDE (directory, written
 *     without the magic), INFO
 *   - WIDE is XORed with "ABCD" (repeating, from the chunk data start); it lists the entries as
 *     absolute file offsets + sizes: nanami.png, MainData, ProjectData, SoraWorkspace, Dummy0..3
 *   - each entry is XORed with one byte of its own: the PNG's is found from its signature, MainData's
 *     from its first u32 (2)
 *   - MainData (S_SceneLibrary) holds three meshes (nanami, 口 mouth, 本体 body). A mesh is a quad
 *     list (4 indices + 0 each) and baked frames of D3D vertices (FVF 0x337, stride 80: xyz at 0,
 *     colour at 0x28, uv at 0x2c), coordinates in pixels about the 512 x 512 texture centre, y up.
 *   - then 13 clips: [u32 0x1002][u32][u32 size][u32 duration] + 124 bytes of 0xCD + groups
 *     0x2000 (node: position vec3, rotation quat wxyz, scale vec3), 0x3000 (per mesh, meaning not
 *     known yet: kept raw), 0x4000 (per mesh: vertex frame index, mouth shape index), 0x5000-0x7000
 *     (empty). A track is [size][clip][-1][interp][count] + keys of [u32 time] + value; interp 0x11
 *     morphs between frames, 0 steps. Times are in milliseconds.
 *   - the mouth mesh carries 7 shapes (口, :D, A, E, I, O, U): a UV offset (and scale) each.
 *   - each mesh's position is in the editor timeline (Clip001); see the offsets below.
 * Only this file is known (the 2009 build, md5 below); other .sora files may lay out differently.
 */
const crypto = require('crypto');
const KNOWN_SORA_MD5 = 'd67bdebdb4e869ffd81fd57a031fdb73'; // nanami.sora in SoraTan.iso (2009 build)

const MAGIC = 0x6e39d92b;
const CLIP_NAMES = ['Startup', 'Anime1', 'Anime2', 'DragL', 'DragR', 'A', 'E', 'I', 'O', 'U', '-', 'test mouth', 'M'];

function readChunks(buf) {
    const chunks = {};
    let o = 0;
    while (o + 12 <= buf.length) {
        // CENT and INFO carry the magic; WIDE follows CENT as a bare [fourcc][size]
        const m = buf.readUInt32LE(o) === MAGIC ? 4 : 0;
        const tag = buf.toString('latin1', o + m, o + m + 4);
        const size = buf.readUInt32LE(o + m + 4);
        if (!/^[A-Z]{4}$/.test(tag)) throw new Error(`no chunk at ${o}`);
        chunks[tag] = { start: o + m + 8, size };
        o += m + 8 + size;
    }
    return chunks;
}

function readDirectory(buf, wide) {
    const d = Buffer.alloc(wide.size);
    for (let i = 0; i < wide.size; i++) d[i] = buf[wide.start + i] ^ 'ABCD'.charCodeAt(i % 4);
    // entries: [u32 offset][u32 size][0xCDCDCDCD][u16 name bytes][u8][u8] name (UTF-16) ...;
    // the name field is not reliably aligned, so take (offset, size) pairs with the name that follows
    const text = d.toString('utf16le');
    const entries = [];
    const want = ['nanami.png', 'MainData'];
    for (const name of want) {
        const at = d.indexOf(Buffer.from(name + '\0', 'utf16le'));
        if (at < 0) throw new Error(`directory has no ${name}`);
        // the (offset, size) pair sits right before the CD padding and the name header
        const pairAt = d.lastIndexOf(Buffer.from([0xcd, 0xcd, 0xcd, 0xcd]), at) - 8;
        entries.push({ name, offset: d.readUInt32LE(pairAt), size: d.readUInt32LE(pairAt + 4) });
    }
    if (!text) throw new Error('empty directory');
    return Object.fromEntries(entries.map((e) => [e.name, e]));
}

function entryBytes(buf, e, key) {
    const out = Buffer.alloc(e.size);
    for (let i = 0; i < e.size; i++) out[i] = buf[e.offset + i] ^ key;
    return out;
}

function isVertex(x, o) {
    if (o + 80 > x.length || x.readUInt32LE(o + 0x28) !== 0xffffffff) return false;
    for (let i = 0x38; i < 0x50; i++) if (x[o + i] !== 0xcd) return false;
    return true;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r5 = (v) => Math.round(v * 100000) / 100000;

function readMesh(x, name, facesAt, firstVertex, verts) {
    const n = x.readUInt32LE(facesAt);
    const faces = [];
    for (let i = 0; i < n; i++) {
        const q = facesAt + 4 + i * 20;
        const f = [0, 1, 2, 3].map((k) => x.readUInt32LE(q + k * 4));
        if (x.readUInt32LE(q + 16) !== 0 || f.some((v) => v >= verts)) throw new Error(`${name}: bad face ${i}`);
        faces.push(f);
    }
    const count = x.readUInt32LE(firstVertex - 24);
    const uvSets = [];
    const uvKey = new Map();
    const frames = [];
    let o = firstVertex;
    for (let fi = 0; fi < count; fi++) {
        if (x.readUInt32LE(o - 20) !== verts * 80 + 16) throw new Error(`${name}: frame ${fi} header`);
        const pos = [];
        const uv = [];
        for (let v = 0; v < verts; v++) {
            const r = o + v * 80;
            if (!isVertex(x, r)) throw new Error(`${name}: frame ${fi} vertex ${v}`);
            pos.push(r2(x.readFloatLE(r)), r2(x.readFloatLE(r + 4)));
            uv.push(r5(x.readFloatLE(r + 0x2c)), r5(x.readFloatLE(r + 0x30)));
        }
        const k = uv.join(',');
        if (!uvKey.has(k)) { uvKey.set(k, uvSets.length); uvSets.push(uv); }
        frames.push({ uv: uvKey.get(k), pos });
        o += verts * 80 + 20;
    }
    return { name, verts, faces, uvSets, frames };
}

function readTrack(x, p) {
    const size = x.readUInt32LE(p);
    const interp = x.readUInt32LE(p + 12);
    const count = x.readUInt32LE(p + 16);
    const keys = [];
    if (count) {
        const ks = (size - 20) / count;
        for (let k = 0; k < count; k++) {
            const q = p + 20 + k * ks;
            const t = x.readUInt32LE(q);
            let val;
            if (ks === 8) val = x.readUInt32LE(q + 4);
            else {
                val = [];
                for (let j = 4; j < ks; j += 4) val.push(Math.round(x.readFloatLE(q + j) * 1e6) / 1e6);
            }
            keys.push([t, val]);
        }
    }
    return { track: keys.length ? { interp, keys } : null, next: p + size };
}

function readClips(x, at) {
    const clips = [];
    let o = at;
    for (const name of CLIP_NAMES) {
        if (x.readUInt32LE(o) !== 0x1002) throw new Error(`clip ${name}: no 0x1002 at ${o.toString(16)}`);
        const size = x.readUInt32LE(o + 8);
        const duration = x.readUInt32LE(o + 12);
        const end = o + 8 + size;
        let p = o + 16;
        while (x[p] === 0xcd) p++;
        const groups = {};
        while (p < end) {
            const type = x.readUInt32LE(p);
            const gend = p + 8 + x.readUInt32LE(p + 8);
            let q = p + 12;
            const n = x.readUInt32LE(q); q += 4;
            const ents = [];
            for (let e = 0; e < n; e++) {
                const eend = q + 8 + x.readUInt32LE(q + 8);
                let r = q + 12;
                const tracks = [];
                while (r < eend) { const t = readTrack(x, r); tracks.push(t.track); r = t.next; }
                ents.push(tracks);
                q = eend;
            }
            groups[type.toString(16)] = ents;
            p = gend;
        }
        const node = (groups['2000'] || [])[0] || [];
        const clip = {
            name,
            duration,
            node: { position: node[1] || null, rotation: node[2] || null, scale: node[3] || null },
            meshes: [0, 1, 2].map((m) => ({
                frame: ((groups['4000'] || [])[m] || [])[0] || null,
                shape: ((groups['4000'] || [])[m] || [])[1] || null,
                g3000: ((groups['3000'] || [])[m] || [])[0] || null
            }))
        };
        clips.push(clip);
        o = end;
    }
    return clips;
}

function readMouthShapes(x, at) {
    const names = ['口', ':D', 'A', 'E', 'I', 'O', 'U'];
    return names.map((name, i) => {
        const r = at + i * 40;
        const f = (k) => Math.round(x.readFloatLE(r + k * 4) * 1e5) / 1e5;
        return { name, du: f(0), dv: f(1), su: f(7), sv: f(8) };
    });
}

function decodeSora(buf) {
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    if (KNOWN_SORA_MD5 && md5 !== KNOWN_SORA_MD5) throw new Error(`nanami.sora md5 ${md5} is not the known build`);
    const chunks = readChunks(buf);
    const dirEntries = readDirectory(buf, chunks.WIDE);

    const pngE = dirEntries['nanami.png'];
    const png = entryBytes(buf, pngE, buf[pngE.offset] ^ 0x89);
    if (png.toString('latin1', 1, 4) !== 'PNG') throw new Error('nanami.png did not decode');
    const mainE = dirEntries.MainData;
    const x = entryBytes(buf, mainE, buf[mainE.offset] ^ 0x02);
    if (x.readUInt32LE(0) !== 2 || x.readUInt32LE(12) !== 0x1001) throw new Error('MainData did not decode');

    // offsets inside MainData for this build (see the header comment); each read is validated
    const meshes = [
        readMesh(x, 'nanami', 0x78, 0x396, 48),
        readMesh(x, '口', 0xa9aa, 0xab4c, 6),
        readMesh(x, '本体', 0x14660, 0x14aa2, 66)
    ];
    meshes[1].shapes = readMouthShapes(x, 0xaa1c);
    // where each mesh sits: the editor timeline (Clip001) keeps a position per mesh. Fitted against
    // SoraTan.exe on the Vista VM: world = node + scale * (vertex + offset) - (0, 256). The nanami
    // mesh (a second full figure) never shows in the toy, so it is kept but marked hidden.
    [0x116438, 0x1164c4, 0x116560].forEach((at, i) => {
        meshes[i].offset = [r2(x.readFloatLE(at)), r2(x.readFloatLE(at + 4))];
    });
    if (Math.abs(meshes[2].offset[0] - 94.04) > 0.01) throw new Error('Clip001 mesh positions moved');
    meshes[0].hidden = true;
    // Node01's rest transform (position, rotation wxyz, scale): what a clip without that track uses
    const f3 = (at, n) => Array.from({ length: n }, (_, i) => Math.round(x.readFloatLE(at + i * 4) * 1e6) / 1e6);
    const node = { position: f3(0x116310, 3), rotation: f3(0x11631c, 4), scale: f3(0x11632c, 3) };
    if (Math.abs(node.scale[0] - 1.073223) > 1e-4) throw new Error('Node01 rest transform moved');
    const clipsAt = x.indexOf(Buffer.from([0x02, 0x10, 0, 0, 0, 0, 0, 0]), 0x116700);
    const clips = readClips(x, clipsAt);

    const scene = {
        version: 1,
        source: { file: 'nanami.sora', md5 },
        texture: 'nanami.png',
        textureSize: 512,
        node,
        meshes,
        clips
    };
    return { scene, png };
}

module.exports = { decodeSora, KNOWN_SORA_MD5 };
